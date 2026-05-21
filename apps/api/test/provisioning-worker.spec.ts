import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvisioningWorkerService } from '../src/provisioning-worker.service';

const originalEnv = { ...process.env };

function setWorkerEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('Provisioning worker service', () => {
  afterEach(() => {
    process.env.PROVISIONING_WORKER_ENABLED = originalEnv.PROVISIONING_WORKER_ENABLED;
    process.env.PROVISIONING_WORKER_INTERVAL_MS = originalEnv.PROVISIONING_WORKER_INTERVAL_MS;
    process.env.PROVISIONING_WORKER_LIMIT = originalEnv.PROVISIONING_WORKER_LIMIT;
  });

  it('is disabled by default so tests and local dev do not start surprise background loops', () => {
    setWorkerEnv({ PROVISIONING_WORKER_ENABLED: undefined, PROVISIONING_WORKER_INTERVAL_MS: undefined, PROVISIONING_WORKER_LIMIT: undefined });
    const worker = new ProvisioningWorkerService({ runDueJobs: vi.fn() } as never);

    expect(worker.getStatus()).toMatchObject({ enabled: false, running: false, intervalMs: 60000, limit: 10 });
  });

  it('runs one bounded due-job batch and prevents overlapping ticks', async () => {
    setWorkerEnv({ PROVISIONING_WORKER_ENABLED: 'true', PROVISIONING_WORKER_INTERVAL_MS: '2500', PROVISIONING_WORKER_LIMIT: '3' });
    let release!: () => void;
    const firstRun = new Promise(resolve => { release = () => resolve({ processed: 1, completed: 1, failed: 0, results: [] }); });
    const runDueJobs = vi.fn().mockReturnValueOnce(firstRun).mockResolvedValueOnce({ processed: 1, completed: 1, failed: 0, results: [] });
    const worker = new ProvisioningWorkerService({ runDueJobs } as never);

    const runningTick = worker.runOnce('worker-test');
    await worker.runOnce('worker-test');
    expect(runDueJobs).toHaveBeenCalledTimes(1);
    expect(worker.getStatus()).toMatchObject({ enabled: true, running: true, intervalMs: 2500, limit: 3 });

    release();
    await runningTick;
    expect(worker.getStatus()).toMatchObject({ enabled: true, running: false, lastResult: { processed: 1, completed: 1, failed: 0 } });

    await worker.runOnce('worker-test');
    expect(runDueJobs).toHaveBeenCalledTimes(2);
    expect(runDueJobs).toHaveBeenLastCalledWith(3, 'worker-test');
  });
});
