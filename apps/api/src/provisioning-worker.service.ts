import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DifyProvisioningService } from './dify-provisioning.service';

type WorkerResult = { processed: number; completed: number; failed: number; results: Array<{ jobId: string; status: string; error?: string }> };

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function workerEnabled(env: NodeJS.ProcessEnv) {
  return env.PROVISIONING_WORKER_ENABLED === 'true';
}

@Injectable()
export class ProvisioningWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProvisioningWorkerService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly limit: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastStartedAt: Date | null = null;
  private lastFinishedAt: Date | null = null;
  private lastResult: WorkerResult | null = null;
  private lastError: string | null = null;

  constructor(private readonly provisioning: DifyProvisioningService) {
    this.enabled = workerEnabled(process.env);
    this.intervalMs = positiveInt(process.env.PROVISIONING_WORKER_INTERVAL_MS, 60_000);
    this.limit = positiveInt(process.env.PROVISIONING_WORKER_LIMIT, 10);
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      void this.runOnce('provisioning-worker');
    }, this.intervalMs);
    this.timer.unref?.();
    void this.runOnce('provisioning-worker');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      limit: this.limit,
      lastStartedAt: this.lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: this.lastFinishedAt?.toISOString() ?? null,
      lastResult: this.lastResult,
      lastError: this.lastError
    };
  }

  async runOnce(actorUserId = 'provisioning-worker') {
    if (this.running) return this.lastResult;
    this.running = true;
    this.lastStartedAt = new Date();
    this.lastError = null;
    try {
      const result = await this.provisioning.runDueJobs(this.limit, actorUserId);
      this.lastResult = result;
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown provisioning worker error';
      this.logger.error(this.lastError);
      throw error;
    } finally {
      this.lastFinishedAt = new Date();
      this.running = false;
    }
  }
}
