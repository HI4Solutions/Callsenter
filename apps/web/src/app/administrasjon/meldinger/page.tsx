"use client";

import { Threads } from "@/components/threads";

export default function OrgMessagesPage() {
  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Meldinger</h1>
        <p className="mt-2 text-muted">Samtaler med VeriQall. Alle med tilgang til administrasjonen ser dem.</p>
      </div>
      <Threads base="/org" />
    </section>
  );
}
