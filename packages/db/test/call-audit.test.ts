import { describe, expect, it } from "vitest";
import { createOrg, member, owner } from "./helpers.ts";

const logged = async (callId: string) =>
  (await owner.query("select action, old_data, new_data from audit_log where table_name = 'calls' and record_id = $1 order by id", [callId]))
    .rows;

describe("audit log of calls", () => {
  it("logs status and links, never the note or title text, and not counters while recording", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    const callId = (
      await owner.query(
        `insert into calls (organization_id, user_id, source, transcription_mode, title, note)
         values ($1, $2, 'microphone', 'chunked', 'Kari Hansen', 'Ring tilbake på 99887766') returning id`,
        [org, seller],
      )
    ).rows[0].id as string;
    // Uploading chunks: counters only, nothing logged.
    await owner.query("update calls set chunk_count = 3, last_chunk_at = now() where id = $1", [callId]);
    await owner.query("update calls set note = 'Kunden vil ha e-post: kari@example.test' where id = $1", [callId]);
    await owner.query("update calls set status = 'processing' where id = $1", [callId]);
    {
      const rows = await logged(callId);
      expect(rows.map((r) => r.action)).toEqual(["insert", "update", "update"]);
      expect(rows[1].new_data).toMatchObject({ note_changed: true, has_note: true });
      expect(rows[2].old_data.status).toBe("recording");
      expect(rows[2].new_data.status).toBe("processing");
      const text = JSON.stringify(rows);
      for (const secret of ["Kari Hansen", "99887766", "kari@example.test", "chunk_count"]) expect(text).not.toContain(secret);
    }
  });
});
