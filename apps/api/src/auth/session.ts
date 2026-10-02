import { SESSION_IDLE_TIMEOUT_MINUTES } from "@veriqall/shared";
import { sha256 } from "./crypto.ts";
import type { AuthDeps, LoginMethod } from "./types.ts";

export interface Session {
  userId: string;
  provider: LoginMethod;
  acr: string | null;
  activeOrganizationId: string | null;
  // Started with BankID or a passkey: only then are administrative permissions held
  // (docs/auth.md).
  strong: boolean;
}

// "Last seen" is written at most once a minute, so every request does not become a write.
const TOUCH_INTERVAL_MS = 60_000;

export async function resolveSession(deps: AuthDeps, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const now = deps.now();
  const { rows } = await deps.authDb.query<{
    user_id: string;
    provider: LoginMethod;
    acr: string | null;
    active_organization_id: string | null;
    last_seen_at: Date;
  }>(
    `select s.user_id, s.provider, s.acr, s.active_organization_id, s.last_seen_at
     from sessions s join users u on u.id = s.user_id
     where s.id_hash = $1 and s.revoked_at is null and u.status = 'active'
       and s.expires_at > $2
       and s.last_seen_at > $2::timestamptz - make_interval(mins => $3)`,
    [sha256(token), now, SESSION_IDLE_TIMEOUT_MINUTES],
  );
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
    await deps.authDb.query("update sessions set last_seen_at = $2 where id_hash = $1", [sha256(token), now]);
  }
  return {
    userId: row.user_id,
    provider: row.provider,
    acr: row.acr,
    activeOrganizationId: row.active_organization_id,
    strong: row.provider === "bankid" || row.provider === "passkey",
  };
}

export async function revokeSession(deps: AuthDeps, token: string | undefined): Promise<void> {
  if (!token) return;
  await deps.authDb.query("update sessions set revoked_at = $2 where id_hash = $1 and revoked_at is null", [
    sha256(token),
    deps.now(),
  ]);
}
