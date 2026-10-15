"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, primaryButton } from "@/components/admin/field";
import { TranscriptPanel } from "@/components/calls/transcript-panel";
import { useCall } from "@/components/calls/use-call";
import { Flag } from "@/components/flag";
import { FLAG_LEVEL, formatDuration } from "@/lib/calls";
import { formatDate, formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";

// The recording of the call a complaint is about. The link to the audio is short-lived and every
// playback is logged; a click on a timestamp (in the transcript or the assessment) starts there.
export function useCallPlayer(callId: string | null) {
  const [audio, setAudio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where to start when the player has loaded (a click on a timestamp before playback).
  const [startAt, setStartAt] = useState<number | null>(null);
  const element = useRef<HTMLAudioElement | null>(null);
  const attach = useCallback((node: HTMLAudioElement | null) => {
    element.current = node;
  }, []);

  const play = useCallback(
    async (atMs?: number) => {
      setError(null);
      const el = element.current;
      if (audio && el) {
        if (atMs !== undefined) el.currentTime = atMs / 1000;
        void el.play().catch(() => undefined);
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      if (!callId) return;
      try {
        setStartAt(atMs ?? 0);
        setAudio(
          (await orgFetch<{ url: string }>(`/calls/${callId}/audio`)).url,
        );
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [audio, callId],
  );

  // Starts where asked once the recording has loaded.
  const loaded = useCallback(
    (el: HTMLAudioElement) => {
      if (startAt === null) return;
      el.currentTime = startAt / 1000;
      setStartAt(null);
      void el.play().catch(() => undefined);
    },
    [startAt],
  );

  // The link lasts ten minutes; after that the button comes back for a new one.
  const expired = useCallback(() => setAudio(null), []);

  return { audio, error, attach, play, loaded, expired };
}

export function ComplaintCall({
  callId,
  canPlay,
  audio,
  audioError,
  audioRef,
  onPlay,
  onLoaded,
  onExpired,
}: {
  callId: string;
  canPlay: boolean;
  // From useCallPlayer, so a timestamp elsewhere on the page can start the recording too.
  audio: string | null;
  audioError: string | null;
  audioRef: (node: HTMLAudioElement | null) => void;
  onPlay: (atMs?: number) => void;
  onLoaded: (el: HTMLAudioElement) => void;
  onExpired: () => void;
}) {
  const t = useTranslations("complaints.detail");
  const tc = useTranslations("calls");
  const { call, error } = useCall(callId);
  if (!call) return error ? <ErrorMessage message={error} /> : null;
  const analysis = call.analyses[0];
  const notes = call.reports.filter((r) => r.status === "done" && r.content);
  const playable = canPlay && call.hasAudio;

  return (
    <div className="flex flex-col gap-8">
      {playable && (
        <Card title={t("recording")}>
          {audio ? (
            <audio
              ref={audioRef}
              src={audio}
              controls
              preload="metadata"
              className="w-full"
              onError={onExpired}
              onLoadedMetadata={(e) => onLoaded(e.currentTarget)}
            />
          ) : (
            <button
              type="button"
              className={primaryButton}
              onClick={() => onPlay()}
            >
              {t("play")}
            </button>
          )}
          <ErrorMessage message={audioError} />
          <p className="mt-2 text-sm text-muted">
            {[
              formatDateTime(call.startedAt),
              call.userName,
              call.durationMs !== null && formatDuration(call.durationMs),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 text-sm text-muted">
            {tc("detail.expires", { date: formatDate(call.expiresAt) })}
          </p>
          <Link
            href={`/samtaler/${call.id}`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand print:hidden"
          >
            {t("openCall")}
          </Link>
        </Card>
      )}
      <Card title={t("notes")}>
        {notes.length ? (
          <div className="flex flex-col gap-4">
            {notes.map((n) => (
              <div key={n.id}>
                <p className="text-sm font-semibold text-muted">
                  {n.templateName}
                </p>
                <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {n.content}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">{t("noNotes")}</p>
        )}
      </Card>
      {analysis && (
        <Card title={t("control")}>
          <div className="flex flex-col gap-2">
            <Flag level={FLAG_LEVEL[analysis.flag]} />
            {analysis.summary && (
              <p className="whitespace-pre-wrap">{analysis.summary}</p>
            )}
          </div>
        </Card>
      )}
      {call.segments.length > 0 && (
        <TranscriptPanel
          segments={call.segments}
          onSeek={playable ? onPlay : undefined}
        />
      )}
    </div>
  );
}
