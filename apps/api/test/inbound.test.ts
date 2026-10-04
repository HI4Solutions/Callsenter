import { randomBytes } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { owner, worker } from "../../../packages/db/test/helpers.ts";
import { isSesEvent, newText, receiveEmails } from "../src/inbound.ts";

// A fake S3 holding raw messages under inbound/<id>.
function fakeS3(objects: Record<string, string>) {
  const deleted: string[] = [];
  const client = {
    send: async (command: { input: { Key: string }; constructor: { name: string } }) => {
      if (command.constructor.name === "DeleteObjectCommand") {
        deleted.push(command.input.Key);
        return {};
      }
      const raw = objects[command.input.Key];
      if (raw === undefined) throw new Error(`no object ${command.input.Key}`);
      return { Body: { transformToByteArray: async () => new TextEncoder().encode(raw) } };
    },
  } as unknown as S3Client;
  return { client, deleted };
}

const event = (id: string, spam = "PASS") => ({
  Records: [{ eventSource: "aws:ses", ses: { mail: { messageId: id }, receipt: { spamVerdict: { status: spam }, virusVerdict: { status: "PASS" } } } }],
});

describe("incoming e-mail", () => {
  it("stores the new part of an answer in the sender's thread, once", async () => {
    const id = randomBytes(6).toString("hex");
    const from = `ola-${id}@example.test`;
    const raw = [
      `From: Ola Nordmann <${from.toUpperCase()}>`,
      "To: kontakt@svar.example.test",
      "Subject: Re: Svar på henvendelsen din til VeriQall",
      `Message-ID: <${id}@mail.example.test>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Tirsdag passer fint for oss.",
      "",
      "Den 3. okt. 2026 kl. 21:00 skrev VeriQall <noreply@staging.veriqall.no>:",
      "> Hei Ola, vi kan vise en demo.",
    ].join("\r\n");
    const s3 = fakeS3({ [`inbound/${id}`]: raw });
    expect(isSesEvent(event(id))).toBe(true);
    expect(isSesEvent({ task: "daily" })).toBe(false);
    expect(await receiveEmails(worker, event(id), "bucket", s3.client)).toEqual({ stored: 1 });
    expect(await receiveEmails(worker, event(id), "bucket", s3.client)).toEqual({ stored: 0 });
    const rows = (await owner.query("select email, direction, name, subject, body from contact_messages where email = $1", [from])).rows;
    expect(rows).toEqual([{ email: from, direction: "in", name: "Ola Nordmann", subject: "Re: Svar på henvendelsen din til VeriQall", body: "Tirsdag passer fint for oss." }]);
  });

  it("drops spam without storing it", async () => {
    const id = randomBytes(6).toString("hex");
    const s3 = fakeS3({});
    expect(await receiveEmails(worker, event(id, "FAIL"), "bucket", s3.client)).toEqual({ stored: 0 });
    expect(s3.deleted).toEqual([`inbound/${id}`]);
  });

  it("finds where the quoted message starts in several languages", () => {
    expect(newText("Ja takk.\n\nOn Fri, 3 Oct 2026 at 21:00, VeriQall <noreply@x> wrote:\n> Hei")).toBe("Ja takk.");
    expect(newText("Gerne.\n\nAm 03.10.2026 um 21:00 schrieb VeriQall:\n> Hallo")).toBe("Gerne.");
    expect(newText("Ok\n-----Original Message-----\nFrom: x")).toBe("Ok");
    expect(newText("> bare sitat")).toBe("> bare sitat");
  });
});
