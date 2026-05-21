import Redis from 'ioredis';

export type RateLimitResult = { allowed: boolean; count: number; resetAt: number; store: 'memory' | 'redis' };
export type RateLimitInput = { namespace: string; key: string; max: number; windowMs: number };

export interface RateLimitStore {
  hit(input: RateLimitInput): Promise<RateLimitResult>;
}

type MemoryBucket = { count: number; resetAt: number };

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, MemoryBucket>();

  async hit(input: RateLimitInput): Promise<RateLimitResult> {
    const bucketKey = `${input.namespace}:${input.key}`;
    const now = Date.now();
    const existing = this.buckets.get(bucketKey);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + input.windowMs;
      this.buckets.set(bucketKey, { count: 1, resetAt });
      return { allowed: true, count: 1, resetAt, store: 'memory' };
    }
    if (existing.count >= input.max) {
      return { allowed: false, count: existing.count, resetAt: existing.resetAt, store: 'memory' };
    }
    existing.count += 1;
    return { allowed: true, count: existing.count, resetAt: existing.resetAt, store: 'memory' };
  }

  clear() {
    this.buckets.clear();
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  }

  async hit(input: RateLimitInput): Promise<RateLimitResult> {
    const key = `dify-saas:rate-limit:${input.namespace}:${input.key}`;
    const now = Date.now();
    const windowSeconds = Math.max(1, Math.ceil(input.windowMs / 1000));
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, input.windowMs);
    const ttlMs = await this.redis.pttl(key);
    const resetAt = now + (ttlMs > 0 ? ttlMs : windowSeconds * 1000);
    return { allowed: count <= input.max, count, resetAt, store: 'redis' };
  }
}

let singleton: RateLimitStore | null = null;
let singletonSignature = '';

export function createRateLimitStoreFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  const mode = env.RATE_LIMIT_STORE || (env.REDIS_URL ? 'redis' : 'memory');
  if (mode === 'redis') {
    if (!env.REDIS_URL) throw new Error('REDIS_URL is required when RATE_LIMIT_STORE=redis');
    return new RedisRateLimitStore(env.REDIS_URL);
  }
  return new InMemoryRateLimitStore();
}

export function getRateLimitStore() {
  const signature = `${process.env.RATE_LIMIT_STORE || ''}:${process.env.REDIS_URL || ''}`;
  if (!singleton || singletonSignature !== signature) {
    singleton = createRateLimitStoreFromEnv();
    singletonSignature = signature;
  }
  return singleton;
}

export function resetRateLimitStoreForTests() {
  singleton = null;
  singletonSignature = '';
}
