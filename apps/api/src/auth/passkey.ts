// Passkeys (WebAuthn), docs/auth.md. Registration needs a session started with BankID; a passkey
// login then counts as strong authentication. The ceremony runs in the browser on the app's
// origin, so the relying party id is the app's host name (for example staging.veriqall.no).
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomToken } from "./crypto.ts";
import { insertSession, logEvent, safeReturnPath, withTransaction, type RequestMeta } from "./flow.ts";
import type { Session } from "./session.ts";
import { withSession } from "../me.ts";
import type { AuthDeps } from "./types.ts";

const CHALLENGE_MINUTES = 5;

export class PasskeyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function relyingParty(deps: AuthDeps) {
  const origin = deps.config.appOrigin;
  return { origin, rpID: new URL(origin).hostname };
}

async function saveChallenge(deps: AuthDeps, challenge: string, purpose: "register" | "login", userId: string | null) {
  const { rows } = await deps.authDb.query<{ id: string }>(
    "insert into webauthn_challenges (challenge, purpose, user_id, created_at) values ($1, $2, $3, $4) returning id",
    [challenge, purpose, userId, deps.now()],
  );
  return rows[0]!.id;
}

// Marks the challenge used and returns it, so it works once and only within five minutes.
async function takeChallenge(deps: AuthDeps, id: unknown, purpose: "register" | "login", userId: string | null) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new PasskeyError(400, "Ugyldig forespørsel.");
  const now = deps.now();
  const { rows } = await deps.authDb.query<{ challenge: string }>(
    `update webauthn_challenges set used_at = $2
     where id = $1 and purpose = $3 and used_at is null
       and created_at > $2::timestamptz - make_interval(mins => $4)
       and user_id is not distinct from $5
     returning challenge`,
    [id, now, purpose, CHALLENGE_MINUTES, userId],
  );
  if (!rows[0]) throw new PasskeyError(400, "Forespørselen er utløpt. Prøv igjen.");
  return rows[0].challenge;
}

export async function registrationOptions(deps: AuthDeps, session: Session) {
  if (session.provider !== "bankid") {
    throw new PasskeyError(403, "Du må være logget inn med BankID for å legge til en passkey.");
  }
  const { rpID } = relyingParty(deps);
  const user = await withSession(deps.appDb, session, async (c) => {
    const u = await c.query<{ full_name: string; email: string | null; phone: string | null }>(
      "select full_name, email, phone from users where id = $1",
      [session.userId],
    );
    const keys = await c.query<{ credential_id: string; transports: string[] }>(
      "select credential_id, transports from passkeys where user_id = $1",
      [session.userId],
    );
    return { ...u.rows[0]!, keys: keys.rows };
  });
  const options = await generateRegistrationOptions({
    rpName: "VeriQall",
    rpID,
    userName: user.email ?? user.phone ?? user.full_name,
    userDisplayName: user.full_name,
    userID: new TextEncoder().encode(session.userId),
    attestationType: "none",
    excludeCredentials: user.keys.map((k) => ({ id: k.credential_id, transports: k.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = await saveChallenge(deps, options.challenge, "register", session.userId);
  return { challengeId, options };
}

export async function registerPasskey(deps: AuthDeps, session: Session, body: Record<string, unknown>) {
  if (session.provider !== "bankid") {
    throw new PasskeyError(403, "Du må være logget inn med BankID for å legge til en passkey.");
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Passkey";
  const challenge = await takeChallenge(deps, body.challengeId, "register", session.userId);
  const { origin, rpID } = relyingParty(deps);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    console.warn("passkey registration rejected", (error as Error).message);
    throw new PasskeyError(400, "Passkeyen kunne ikke bekreftes. Prøv igjen.");
  }
  if (!verification.verified) throw new PasskeyError(400, "Passkeyen kunne ikke bekreftes. Prøv igjen.");
  const { credential } = verification.registrationInfo;
  return withSession(deps.appDb, session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into passkeys (user_id, credential_id, public_key, counter, transports, name)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [session.userId, credential.id, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? [], name],
    );
    return { id: rows[0]!.id, name };
  });
}

export async function authenticationOptions(deps: AuthDeps) {
  const { rpID } = relyingParty(deps);
  // No allowCredentials: the browser offers the passkeys it has for this site.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const challengeId = await saveChallenge(deps, options.challenge, "login", null);
  return { challengeId, options };
}

export interface PasskeyLogin {
  location: string;
  sessionToken: string;
}

export async function loginWithPasskey(deps: AuthDeps, body: Record<string, unknown>, meta: RequestMeta): Promise<PasskeyLogin> {
  const challenge = await takeChallenge(deps, body.challengeId, "login", null);
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response.id !== "string") throw new PasskeyError(400, "Ugyldig forespørsel.");

  const found = await deps.authDb.query<{
    id: string;
    user_id: string;
    public_key: Buffer;
    counter: string;
    transports: string[];
    status: string;
  }>(
    `select p.id, p.user_id, p.public_key, p.counter, p.transports, u.status
     from passkeys p join users u on u.id = p.user_id where p.credential_id = $1`,
    [response.id],
  );
  const key = found.rows[0];
  if (!key) {
    await logEvent(deps, "passkey", "unknown_identity", meta, undefined, "unknown passkey");
    throw new PasskeyError(400, "Denne passkeyen er ikke registrert. Logg inn med BankID eller Vipps.");
  }

  const { origin, rpID } = relyingParty(deps);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: response.id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports },
      requireUserVerification: true,
    });
  } catch (error) {
    await logEvent(deps, "passkey", "invalid", meta, key.user_id, (error as Error).message);
    throw new PasskeyError(400, "Passkeyen kunne ikke bekreftes. Prøv igjen.");
  }
  if (!verification.verified) {
    await logEvent(deps, "passkey", "invalid", meta, key.user_id, "not verified");
    throw new PasskeyError(400, "Passkeyen kunne ikke bekreftes. Prøv igjen.");
  }
  if (key.status === "disabled") {
    await logEvent(deps, "passkey", "invalid", meta, key.user_id, "user is disabled");
    throw new PasskeyError(403, "Brukeren din er deaktivert. Ta kontakt med lederen din.");
  }

  const now = deps.now();
  const sessionToken = randomToken();
  await withTransaction(deps.authDb, async (db) => {
    await db.query("update passkeys set counter = $2, last_used_at = $3 where id = $1", [
      key.id,
      verification.authenticationInfo.newCounter,
      now,
    ]);
    await db.query("update users set status = 'active', last_login_at = $2 where id = $1", [key.user_id, now]);
    await insertSession(db, sessionToken, key.user_id, "passkey", null, now, meta);
  });
  await logEvent(deps, "passkey", "success", meta, key.user_id);
  const next = typeof body.next === "string" ? body.next : undefined;
  return { location: safeReturnPath(next), sessionToken };
}

export async function listMyPasskeys(deps: AuthDeps, session: Session) {
  return withSession(deps.appDb, session, async (c) => {
    const { rows } = await c.query(
      `select id, name, created_at as "createdAt", last_used_at as "lastUsedAt"
       from passkeys where user_id = $1 order by created_at`,
      [session.userId],
    );
    return rows;
  });
}

export async function deleteMyPasskey(deps: AuthDeps, session: Session, id: string) {
  return withSession(deps.appDb, session, async (c) => {
    const { rowCount } = await c.query("delete from passkeys where id = $1 and user_id = $2", [id, session.userId]);
    if (!rowCount) throw new PasskeyError(404, "Fant ikke passkeyen.");
    return { id };
  });
}
