import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addMember, api, as, createOrg, createUser, hash32, member, owner, rejects } from "./helpers.ts";

const summary = (userId: string, orgId: string) =>
  as(api, { userId, orgId }, async (db) => (await db.query("select app.org_summary() as s")).rows[0].s);

describe("the call centre admin's overview", () => {
  it("counts users, logins, teams, roles, usage, activity and invoices", async () => {
    const org = await createOrg();
    await owner.query("insert into organization_modules (organization_id, module) values ($1, 'dashboard'), ($1, 'transcription')", [org]);
    const nord = (await owner.query("insert into teams (organization_id, name) values ($1, 'Nord') returning id", [org])).rows[0].id;
    const admin = await member(org, "admin");
    const kari = await member(org, "seller");
    const ola = await member(org, "seller");
    const invited = await createUser("Ny Selger", "invited");
    await addMember(org, invited, "seller");
    const stale = await createUser("Gammel Invitasjon", "invited");
    await addMember(org, stale, "seller");
    const gone = await member(org, "seller");
    await owner.query("update memberships set status = 'disabled' where organization_id = $1 and user_id = $2", [org, gone]);
    await owner.query("update memberships set team_id = $2 where organization_id = $1 and user_id = any($3)", [org, nord, [kari, ola]]);
    await owner.query("update users set last_login_at = now() - interval '1 day' where id = any($1)", [[admin, kari]]);
    await owner.query("update users set last_login_at = now() - interval '40 days' where id = $1", [ola]);
    await owner.query("insert into identities (user_id, provider, subject) values ($1, 'bankid', $2), ($3, 'vipps', $4), ($5, 'vipps', $6)", [
      admin,
      randomUUID(),
      kari,
      randomUUID(),
      ola,
      randomUUID(),
    ]);
    await owner.query("insert into passkeys (user_id, credential_id, public_key, name) values ($1, $2, $3, 'Mac')", [admin, randomUUID(), hash32()]);
    await owner.query("insert into invitations (organization_id, user_id, token_hash) values ($1, $2, $3)", [org, invited, hash32()]);
    await owner.query("insert into invitations (organization_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() - interval '1 day')", [
      org,
      stale,
      hash32(),
    ]);

    // Usage this month: one call in four pieces of 15 minutes (one hour), and its AI control.
    const call = (
      await owner.query("insert into calls (organization_id, user_id, source, transcription_mode) values ($1, $2, 'microphone', 'chunked') returning id", [
        org,
        kari,
      ])
    ).rows[0].id;
    for (const piece of [0, 1, 2, 3]) {
      await owner.query("insert into usage_events (organization_id, call_id, kind, audio_seconds, piece) values ($1, $2, 'transcription_async', 900, $3)", [
        org,
        call,
        piece,
      ]);
    }
    await owner.query("insert into usage_events (organization_id, call_id, kind, input_tokens, output_tokens) values ($1, $2, 'ai_control', 1000, 100)", [org, call]);

    // An invoice past its due date, half paid.
    const invoice = (
      await owner.query(
        `insert into invoices (organization_id, kind, status, number, total, due_date, issue_date)
         values ($1, 'invoice', 'sent', 90001, 1000, app.oslo_today() - 3, app.oslo_today() - 17) returning id`,
        [org],
      )
    ).rows[0].id;
    await owner.query("insert into invoice_payments (invoice_id, organization_id, amount, paid_on) values ($1, $2, 400, app.oslo_today())", [invoice, org]);

    const s = await summary(admin, org);
    expect(s.members).toMatchObject({
      active: 3,
      invited: 2,
      disabled: 1,
      loggedIn7: 2,
      inactive30: 1,
      bankid: 1,
      vipps: 2,
      passkey: 1,
      invitationsPending: 1,
      invitationsExpired: 1,
    });
    expect(s.teams.teams).toEqual([{ id: nord, name: "Nord", members: 2 }]);
    expect(s.teams.withoutTeam).toBe(3);
    expect(s.roles).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Selger", members: 4 })]));
    expect(s.usage.month).toEqual({ hours: 1, controls: 1, notes: 0 });
    expect(s.activity).toEqual([{ teamId: nord, name: "Nord", calls: 1, sales: 0, confirmed: 0 }]);
    expect(s.invoices).toMatchObject({ unpaid: 1, unpaidAmount: 600, overdue: 1, nextDue: null });
    expect(s.modules).toEqual(["dashboard", "transcription"]);
    expect(s.organization).toMatchObject({ status: "active" });

    // Only for users.manage; parts need their own permissions.
    const leader = await member(org, "leader");
    await as(api, { userId: leader, orgId: org }, async (db) => {
      await rejects(db, "select app.org_summary()", [], /no access to the overview/);
    });
    const role = (await owner.query("select role_id from memberships where organization_id = $1 and user_id = $2", [org, admin])).rows[0].role_id;
    await owner.query("delete from role_permissions where role_id = $1 and permission in ('billing.read', 'dashboard.all')", [role]);
    const limited = await summary(admin, org);
    expect(limited.invoices).toBeNull();
    expect(limited.activity).toBeNull();
  });
});
