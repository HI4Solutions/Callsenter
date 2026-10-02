// Blocked IP addresses (superadmin portal, Sikkerhet). Checked on every request except
// /health, through the login role, with a short cache so a busy client costs one query a minute.
import type pg from "pg";

const TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;
const cache = new Map<string, { blocked: boolean; until: number }>();

export async function isBlocked(db: pg.Pool, ip: string | undefined, now = Date.now()): Promise<boolean> {
  if (!ip) return false;
  const hit = cache.get(ip);
  if (hit && hit.until > now) return hit.blocked;
  let blocked = false;
  try {
    const { rows } = await db.query<{ blocked: boolean }>(
      `select exists (select 1 from blocked_ips
                      where removed_at is null and (expires_at is null or expires_at > now())
                        and $1::inet <<= network) as blocked`,
      [ip],
    );
    blocked = rows[0]?.blocked === true;
  } catch (error) {
    // An unparsable address or a database hiccup must not lock everyone out.
    console.error("blocklist check failed", error);
    return false;
  }
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(ip, { blocked, until: now + TTL_MS });
  return blocked;
}

export function clearBlocklistCache() {
  cache.clear();
}
