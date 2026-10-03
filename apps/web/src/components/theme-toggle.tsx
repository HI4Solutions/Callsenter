"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import {
  applyResolvedTheme,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const CHANGE_EVENT = "veriqall-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const options = [
  { value: "system", label: "themeSystem" },
  { value: "light", label: "themeLight" },
  { value: "dark", label: "themeDark" },
] as const satisfies readonly { value: ThemePreference; label: string }[];

// Fallback for when localStorage is blocked: the choice then holds until the page reloads.
let memoryPreference: ThemePreference | null = null;

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    // Storage unavailable; fall through to the in-memory value.
  }
  return memoryPreference ?? "system";
}

function applyPreference(preference: ThemePreference) {
  applyResolvedTheme(resolveTheme(preference, window.matchMedia(DARK_QUERY).matches));
}

// Anything that can change the theme (this tab, another tab, the OS) lands here:
// apply the stored preference to the page, then tell React to re-read it.
function subscribe(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  const handler = () => {
    applyPreference(readPreference());
    onChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener(CHANGE_EVENT, handler);
  query.addEventListener("change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(CHANGE_EVENT, handler);
    query.removeEventListener("change", handler);
  };
}

function choose(next: ThemePreference) {
  memoryPreference = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage blocked; memoryPreference carries the choice.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeToggle() {
  const t = useTranslations("shell");
  const preference = useSyncExternalStore(subscribe, readPreference, () => "system" as const);

  return (
    <div role="group" aria-label={t("theme")} className="inline-flex rounded-full border border-line bg-surface p-0.5">
      {options.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          onClick={() => choose(value)}
          className="min-h-9 rounded-full px-3 text-sm font-medium text-muted transition-colors hover:text-fg aria-pressed:bg-brand aria-pressed:text-on-brand"
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}
