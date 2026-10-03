"use client";

import { useState } from "react";
import { Card } from "@/components/admin/card";
import { Field, inputClass } from "@/components/admin/field";
import { type CallDetail, formatDuration } from "@/lib/calls";

// The transcript, always shown in the studio. While recording it is the live text; afterwards
// the transcript made on the server from the stored recording. Nobody can edit it: it is the
// record of what was said, and it matches the audio that is played back.
export function TranscriptPanel({
  segments,
  live,
  status,
  onSeek,
}: {
  segments: CallDetail["segments"];
  live?: { final: string; partial: string; on: boolean } | null;
  // Shown when there is no text yet.
  status?: string;
  onSeek?: (ms: number) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = q ? segments.filter((s) => s.text.toLowerCase().includes(q)) : segments;

  return (
    <Card title="Transkripsjon">
      {live ? (
        <div aria-live="polite" className="max-h-96 overflow-y-auto rounded-lg bg-bg p-3 [overflow-wrap:anywhere]">
          {live.final || live.partial ? (
            <p className="whitespace-pre-wrap">
              {live.final}
              <span className="text-muted">{live.partial}</span>
            </p>
          ) : (
            <p className="text-muted">
              {live.on ? "Teksten kommer her mens dere snakker …" : "Teksten kommer bitvis, omtrent hvert 15. sekund …"}
            </p>
          )}
        </div>
      ) : segments.length ? (
        <>
          <Field label="Søk i samtalen">
            <input type="search" className={`${inputClass} sm:max-w-sm`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <ol className="mt-4 flex max-h-[32rem] flex-col gap-3 overflow-y-auto">
            {shown.map((s) => (
              <li key={s.seq} className="flex gap-3">
                {onSeek ? (
                  <button
                    type="button"
                    className="min-h-11 shrink-0 self-start rounded-lg px-2 font-mono text-sm text-brand tabular-nums hover:bg-bg"
                    onClick={() => onSeek(s.startMs)}
                    title="Spill av herfra"
                  >
                    {formatDuration(s.startMs)}
                  </button>
                ) : (
                  <span className="shrink-0 px-2 pt-1 font-mono text-sm text-muted tabular-nums">{formatDuration(s.startMs)}</span>
                )}
                <p className="min-w-0 pt-1 [overflow-wrap:anywhere]">
                  {s.speaker && <span className="mr-2 text-sm font-semibold text-muted">Taler {s.speaker}</span>}
                  {s.text}
                </p>
              </li>
            ))}
            {shown.length === 0 && <li className="text-muted">Ingen treff.</li>}
          </ol>
        </>
      ) : (
        <p className="text-muted">{status ?? "Ingen transkripsjon ennå."}</p>
      )}
      <p className="mt-4 text-sm text-muted">
        Transkripsjonen lages fra opptaket og kan ikke endres. Taler 1 og 2 skilles automatisk og kan bytte plass.
      </p>
    </Card>
  );
}
