// Cache abstraction for read-heavy data (range charts change rarely but are read
// on every quiz render). An in-memory TTL cache ships by default; the same
// interface is a drop-in for Redis (ioredis) in production — see README.
//
//   Redis version of get/set would be:
//     get: async (k) => JSON.parse((await redis.get(k)) ?? "null")
//     set: async (k, v, ttl) => redis.set(k, JSON.stringify(v), "EX", ttl)

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

class MemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expires: number }>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}

export const cache: Cache = new MemoryCache();
