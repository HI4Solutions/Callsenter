"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SessionHandle,
  type SessionStatus,
  StudioSession,
} from "@/components/calls/studio-session";
import { secondaryButton } from "@/components/admin/field";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { formatDuration } from "@/lib/calls";

// At most this many calls open at once in the studio.
const MAX_TABS = 6;

type Tab = { id: string; n: number };

// Salgsstudio (docs/plan.md, section 18). Each tab is one call (StudioSession). A call can be
// paused while the seller takes another one in a new tab ("+ Ny samtale", shown while a call is
// going on), and resumed later where it stopped. Only one call records at a time: starting or
// resuming one pauses the other. The tab bar only shows once there are two calls.
export default function StudioPage() {
  const me = useWorkMe();
  const t = useTranslations("calls");
  const [tabs, setTabs] = useState<Tab[]>([{ id: "tab-1", n: 1 }]);
  const [active, setActive] = useState("tab-1");
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const handles = useRef(new Map<string, SessionHandle>());
  const next = useRef(2);

  const onStatus = useCallback((id: string, status: SessionStatus) => {
    setStatuses((s) =>
      s[id]?.state === status.state && s[id]?.elapsedMs === status.elapsedMs ? s : { ...s, [id]: status },
    );
  }, []);
  const register = useCallback((id: string, handle: SessionHandle | null) => {
    if (handle) handles.current.set(id, handle);
    else handles.current.delete(id);
  }, []);
  const claimMicrophone = useCallback(async (id: string) => {
    for (const [other, handle] of handles.current) {
      if (other !== id) await handle.pauseIfRecording();
    }
  }, []);

  // Leaving with a call recording or paused asks first.
  const open = Object.values(statuses).some((s) => s.state === "recording" || s.state === "paused" || s.state === "busy");
  useEffect(() => {
    if (!open) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open]);

  if (!me) return null;
  if (!me.permissions.includes("calls.upload")) return <NoAccess text={t("studio.noAccess")} />;

  function addTab() {
    const n = next.current++;
    const tab = { id: `tab-${n}`, n };
    setTabs((list) => [...list, tab]);
    setActive(tab.id);
  }

  function closeTab(id: string) {
    setTabs((list) => {
      const rest = list.filter((tab) => tab.id !== id);
      if (active === id) setActive(rest[Math.max(0, list.findIndex((tab) => tab.id === id) - 1)]!.id);
      return rest;
    });
    setStatuses((all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)));
  }

  const canClose = (id: string) => {
    const state = statuses[id]?.state ?? "idle";
    return tabs.length > 1 && (state === "idle" || state === "done");
  };

  // "+ Ny samtale" opens another call beside the one going on; with one call done or not yet
  // started, the seller simply uses the call that is open. The tabs show once there are two.
  const activeState = statuses[active]?.state ?? "idle";
  const canAdd =
    tabs.length < MAX_TABS && (tabs.length > 1 || activeState === "recording" || activeState === "paused" || activeState === "busy");

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link href="/samtaler" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">
          {t("back")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{t("studio.title")}</h1>
          {canAdd && (
            <button type="button" onClick={addTab} className={secondaryButton}>
              {t("studio.newTab")}
            </button>
          )}
        </div>
        <p className="mt-2 text-muted">{t("studio.intro")}</p>
      </div>

      {tabs.length > 1 && (
        <div className="scroll-x -mx-4 flex items-end gap-1 border-b border-line px-4 sm:mx-0 sm:px-0">
          <div role="tablist" aria-label={t("studio.tabs")} className="flex items-end gap-1">
            {tabs.map((tab) => {
              const status = statuses[tab.id];
              const selected = tab.id === active;
              return (
                <div key={tab.id} className="flex flex-none items-center">
                  <button
                    type="button"
                    role="tab"
                    id={`${tab.id}-tab`}
                    aria-selected={selected}
                    aria-controls={tab.id}
                    onClick={() => setActive(tab.id)}
                    className={`-mb-px inline-flex min-h-11 items-center gap-2 rounded-t-lg border px-3 text-sm font-semibold whitespace-nowrap ${
                      selected ? "border-line border-b-surface bg-surface text-fg" : "border-transparent text-muted hover:text-fg"
                    }`}
                  >
                    {status?.state === "recording" && (
                      <span aria-hidden className="size-2 animate-pulse rounded-full bg-brand motion-reduce:animate-none" />
                    )}
                    {t("studio.tabLabel", { n: tab.n })}
                    {(status?.state === "recording" || status?.state === "paused") && (
                      <span className="font-normal text-muted">
                        {status.state === "paused" ? `${t("studio.pausedBadge")} ` : ""}
                        {formatDuration(status.elapsedMs)}
                      </span>
                    )}
                    {status?.state === "done" && <span className="font-normal text-muted">{t("studio.tabDone")}</span>}
                  </button>
                  {canClose(tab.id) && (
                    <button
                      type="button"
                      onClick={() => closeTab(tab.id)}
                      aria-label={t("studio.closeTab", { n: tab.n })}
                      title={t("studio.closeTab", { n: tab.n })}
                      className="inline-flex size-11 items-center justify-center text-muted hover:text-fg"
                    >
                      <span aria-hidden>×</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={tab.id}
          role={tabs.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={tabs.length > 1 ? `${tab.id}-tab` : undefined}
          hidden={tab.id !== active}
        >
          <StudioSession tabId={tab.id} onStatus={onStatus} register={register} claimMicrophone={claimMicrophone} />
        </div>
      ))}
    </section>
  );
}
