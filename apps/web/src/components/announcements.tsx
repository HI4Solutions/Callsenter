"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/auth";

interface Announcement {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  linkText: string | null;
}

const DISMISSED_KEY = "veriqall-dismissed-announcements";

function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

// Announcements from the superadmin (Meldinger) for the signed-in user. Each can be closed; that
// is remembered in this browser only.
export function Announcements() {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    fetch(`${API_URL}/announcements`, { credentials: "include" })
      .then(async (res) => (res.ok ? ((await res.json()) as Announcement[]) : []))
      .catch(() => [])
      .then((list) => {
        if (cancelled) return;
        const dismissed = new Set(readDismissed());
        setItems(list.filter((a) => !dismissed.has(a.id)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss(id: string) {
    setItems((current) => current.filter((a) => a.id !== id));
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), id].slice(-50)));
    } catch {
      // Not remembered; it shows again next time.
    }
  }

  if (items.length === 0) return null;
  return (
    <div className="border-b border-line bg-surface">
      <ul className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6">
        {items.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-4" role="status">
            <div>
              <p className="font-semibold">{a.title}</p>
              <p className="whitespace-pre-line text-sm">{a.body}</p>
              {a.linkUrl && (
                <a href={a.linkUrl} className="text-sm font-semibold text-brand" rel="noopener noreferrer" target="_blank">
                  {a.linkText || "Les mer"}
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(a.id)}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg"
              aria-label={`Lukk «${a.title}»`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
