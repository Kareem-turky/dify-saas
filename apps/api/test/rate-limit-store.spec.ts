import { describe, expect, it } from 'vitest';
import { createRateLimitStoreFromEnv, InMemoryRateLimitStore } from '../src/rate-limit.store';

describe('Rate limit store abstraction', () => {
  it('uses an in-memory store by default and exposes fixed-window counters', async () => {
    const store = createRateLimitStoreFromEnv({}) as InMemoryRateLimitStore;

    const first = await store.hit({ namespace: 'login', key: 'user@example.com', max: 2, windowMs: 60_000 });
    const second = await store.hit({ namespace: 'login', key: 'user@example.com', max: 2, windowMs: 60_000 });
    const third = await store.hit({ namespace: 'login', key: 'user@example.com', max: 2, windowMs: 60_000 });

    expect(first).toMatchObject({ allowed: true, count: 1, store: 'memory' });
    expect(second).toMatchObject({ allowed: true, count: 2, store: 'memory' });
    expect(third).toMatchObject({ allowed: false, count: 2, store: 'memory' });
    expect(third.resetAt).toBeGreaterThan(Date.now());
  });

  it('requires REDIS_URL when the shared Redis mode is explicitly enabled', () => {
    expect(() => createRateLimitStoreFromEnv({ RATE_LIMIT_STORE: 'redis' })).toThrow('REDIS_URL is required');
  });
});
