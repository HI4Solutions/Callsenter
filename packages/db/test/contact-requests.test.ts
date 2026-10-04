import { describe, expect, it } from "vitest";
import { api, as, auth, createOrg, createUser, makePlatformAdmin, member, owner, worker } from "./helpers.ts";

const create = (ip: string, email = "kari@example.test") =>
  auth.query<{ id: string }>("select app.contact_request_create($1, $2, $3, $4, $5, $6, $7, $8) as id", [
    " Kari Nordmann ",
    email,
    "",
    "Nord Callsenter",
    "Vi vil se en demo.",
    "sv",
    ip,
    "vitest",
  ]);

describe("contact requests", () => {
  it("are created from the form without a session, trimmed, with the visitor's language", async () => {
    const { rows } = await create("198.51.100.7");
    const row = (await owner.query("select * from contact_requests where id = $1", [rows[0]!.id])).rows[0];
    expect(row).toMatchObject({ name: "Kari Nordmann", email: "kari@example.test", phone: null, company: "Nord Callsenter", locale: "sv", handled_at: null });
    // An unknown language is dropped, not an error.
    const other = await auth.query<{ id: string }>("select app.contact_request_create('A', 'a@b.c', null, null, 'Hei', 'xx', null, null) as id");
    expect((await owner.query("select locale from contact_requests where id = $1", [other.rows[0]!.id])).rows[0].locale).toBeNull();
    await expect(auth.query("select app.contact_request_create('A', 'not-an-email', null, null, 'Hei', 'nb', null, null)")).rejects.toThrow(/check/);
    // The form's role cannot read what was written.
    await expect(auth.query("select * from contact_requests")).rejects.toThrow(/permission denied/);
  });

  it("stop at ten an hour from one address", async () => {
    for (let i = 0; i < 10; i++) await create("203.0.113.9", `p${i}@example.test`);
    await expect(create("203.0.113.9")).rejects.toThrow(/too many/);
    await create("203.0.113.10");
  });

  it("are read and handled by superadmins only, and the handling is audited", async () => {
    const { rows } = await create("192.0.2.1");
    const id = rows[0]!.id;
    const org = await createOrg();
    const seller = await member(org, "seller");
    await as(api, { userId: seller, orgId: org }, async (db) => {
      expect((await db.query("select id from contact_requests where id = $1", [id])).rows).toHaveLength(0);
      // RLS hides the row: the update touches nothing.
      expect((await db.query("update contact_requests set handled_at = now() where id = $1", [id])).rowCount).toBe(0);
    });
    const admin = await createUser("Super Admin");
    await makePlatformAdmin(admin);
    await as(api, { userId: admin }, async (db) => {
      expect((await db.query("select name from contact_requests where id = $1", [id])).rows[0].name).toBe("Kari Nordmann");
      await db.query("update contact_requests set handled_at = now(), handled_by = app.current_user_id() where id = $1", [id]);
      const audit = await db.query("select action from audit_log where table_name = 'contact_requests' and record_id = $1", [id]);
      expect(audit.rows.map((r) => r.action)).toContain("update");
    });
    // Who is told: superadmins with an e-mail address.
    await owner.query("update users set email = $2 where id = $1", [admin, `super-${admin.slice(0, 8)}@example.test`]);
    const recipients = (await auth.query<{ email: string }>("select email from app.contact_request_recipients() as email")).rows.map((r) => r.email);
    expect(recipients).toContain(`super-${admin.slice(0, 8)}@example.test`);
  });

  it("keep the correspondence for superadmins, with e-mails received by the worker", async () => {
    const admin = await createUser("Svar Admin");
    await makePlatformAdmin(admin);
    const email = `kari-${admin.slice(0, 8)}@example.test`;
    // Received twice by SES: stored once.
    const receive = () => worker.query<{ added: boolean }>("select app.contact_message_receive($1, 'Kari', 'Re: Hei', 'Takk!', $2) as added", [email.toUpperCase(), `<m-${admin}>`]);
    expect((await receive()).rows[0]!.added).toBe(true);
    expect((await receive()).rows[0]!.added).toBe(false);
    await expect(worker.query("select * from contact_messages")).rejects.toThrow(/permission denied/);
    await as(api, { userId: admin }, async (db) => {
      const rows = (await db.query("select email, direction, read_at from contact_messages where email = $1", [email])).rows;
      expect(rows).toEqual([{ email, direction: "in", read_at: null }]);
      await db.query("insert into contact_messages (email, direction, body, sent_by) values ($1, 'out', 'Hei igjen', $2)", [email, admin]);
      // An outgoing message needs its author.
      await expect(db.query("insert into contact_messages (email, direction, body) values ($1, 'out', 'x')", [email])).rejects.toThrow(/check/);
    });
    const org = await createOrg();
    const seller = await member(org, "seller");
    await as(api, { userId: seller, orgId: org }, async (db) => {
      expect((await db.query("select id from contact_messages where email = $1", [email])).rows).toHaveLength(0);
      await expect(db.query("insert into contact_messages (email, direction, body, sent_by) values ($1, 'out', 'x', $2)", [email, seller])).rejects.toThrow(/row-level security/);
    });
  });
});
