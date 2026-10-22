// Keep the existing export, object names, SQLite hits schema, milliseconds,
// expiry key and alarm behavior. Deploys must not reset brute-force buckets.
export function persistentRateLimitClass(DurableObject) {
  return class extends DurableObject {
    async allow(maximum, windowSeconds) {
      if (!Number.isInteger(maximum) || maximum <= 0 || maximum > 1_000_000
          || !Number.isInteger(windowSeconds) || windowSeconds <= 0 || windowSeconds > 86400) {
        throw new Error("Invalid rate limit");
      }
      const now = Date.now();
      const window = windowSeconds * 1000;
      const sql = this.ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS hits (at INTEGER NOT NULL)");
      sql.exec("DELETE FROM hits WHERE at <= ?", now - window);
      const row = sql.exec("SELECT count(*) AS n, min(at) AS first FROM hits").one();
      if (row.n >= maximum) {
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((row.first + window - now) / 1000)) };
      }
      sql.exec("INSERT INTO hits(at) VALUES (?)", now);
      await this.ctx.storage.put("expires", now + window);
      await this.ctx.storage.setAlarm(now + window);
      return { allowed: true, retryAfter: 0 };
    }

    async alarm() {
      const expires = await this.ctx.storage.get("expires");
      if (expires != null && expires > Date.now()) {
        await this.ctx.storage.setAlarm(expires);
      } else {
        await this.ctx.storage.deleteAll();
      }
    }
  };
}
