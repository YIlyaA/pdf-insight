export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Best-effort per-isolate limiter used when the Cloudflare rate limit binding is not configured. */
export function createMemoryLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
  maxKeys = 1000,
): RateLimiter & { size(): number } {
  const hits = new Map<string, { count: number; start: number }>();

  const prune = (t: number) => {
    for (const [key, entry] of hits) if (t - entry.start >= windowMs) hits.delete(key);
    while (hits.size >= maxKeys) {
      const oldest = hits.keys().next();
      if (oldest.done) break;
      hits.delete(oldest.value);
    }
  };

  return {
    size: () => hits.size,
    async limit({ key }) {
      const t = now();
      const entry = hits.get(key);
      if (entry && t - entry.start < windowMs) {
        entry.count += 1;
        return { success: entry.count <= max };
      }
      if (!entry) prune(t);
      hits.set(key, { count: 1, start: t });
      return { success: true };
    },
  };
}
