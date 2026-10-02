import { createHash, randomBytes } from "node:crypto";
import type { ClientBase } from "pg";

export interface PlatformAdminInvitation {
  userId: string;
  // Shown once to whoever ran the command; only its hash is stored.
  token: string;
  expiresAt: Date;
}

// Creates (or reuses) a superadmin user and an invitation without a call centre. Runs as the
// owner, through the migrator Lambda; the API can never create superadmins (docs/auth.md).
// The invitee opens the link and signs in with BankID or Vipps; superadmin powers then only
// apply in sessions started with BankID (migration 0002).
export async function invitePlatformAdmin(
  client: ClientBase,
  input: { fullName: string; phone?: string; email?: string },
): Promise<PlatformAdminInvitation> {
  const fullName = input.fullName?.trim();
  if (!fullName) throw new Error("fullName is required");
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;

  await client.query("begin");
  try {
    const existing = await client.query<{ id: string }>(
      "select id from users where (phone = $1) or (lower(email) = lower($2)) order by created_at limit 1",
      [phone, email],
    );
    let userId = existing.rows[0]?.id;
    if (!userId) {
      const created = await client.query<{ id: string }>(
        "insert into users (full_name, phone, email) values ($1, $2, $3) returning id",
        [fullName, phone, email],
      );
      userId = created.rows[0]!.id;
    }
    await client.query(
      `insert into platform_admins (user_id) values ($1)
       on conflict (user_id) do update set revoked_at = null, granted_at = now()
       where platform_admins.revoked_at is not null`,
      [userId],
    );
    const token = randomBytes(32).toString("base64url");
    const { rows } = await client.query<{ expires_at: Date }>(
      "insert into invitations (organization_id, user_id, token_hash) values (null, $1, $2) returning expires_at",
      [userId, createHash("sha256").update(token).digest()],
    );
    await client.query("commit");
    return { userId, token, expiresAt: rows[0]!.expires_at };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
