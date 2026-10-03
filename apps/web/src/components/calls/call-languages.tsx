"use client";

import {
  type Locale,
  LOCALE_CODES,
  LOCALES,
  MAX_TRANSCRIPTION_LANGUAGES,
  SONIOX_LANGUAGES,
} from "@veriqall/shared";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Field, inputClass } from "@/components/admin/field";

export interface CallLanguageChoice {
  // null follows the call centre.
  outputLocale: Locale | null;
  spokenLanguages: string[] | null;
}

// The name of a spoken language (a Soniox code) in the page's language, from the browser.
export function useLanguageName() {
  const locale = useLocale();
  return useMemo(() => {
    const names = new Intl.DisplayNames([LOCALES[locale].tag], {
      type: "language",
    });
    return (code: string) => {
      const name = names.of(code) ?? code;
      return (
        name.charAt(0).toLocaleUpperCase(LOCALES[locale].tag) + name.slice(1)
      );
    };
  }, [locale]);
}

// The languages of one call (docs/plan.md, section 19): what the notes and the AI control are
// written in, and which languages Soniox should expect in the call. Both follow the call centre
// until changed.
export function CallLanguages({
  value,
  defaults,
  onChange,
}: {
  value: CallLanguageChoice;
  defaults: {
    outputLocale: Locale;
    spokenLanguages: string[];
    outputLocaleLocked?: boolean;
  };
  onChange: (next: CallLanguageChoice) => void;
}) {
  const t = useTranslations("languages");
  const spoken = value.spokenLanguages ?? defaults.spokenLanguages;

  function setSpoken(next: string[]) {
    // Back to following the call centre when it matches its list.
    const same =
      next.length === defaults.spokenLanguages.length &&
      next.every((c, i) => c === defaults.spokenLanguages[i]);
    onChange({ ...value, spokenLanguages: same ? null : next });
  }

  return (
    <div className="flex flex-col gap-4">
      {defaults.outputLocaleLocked ? (
        <p className="text-sm">
          <span className="font-semibold">{t("outputLanguage")}: </span>
          {t("locked", { language: LOCALES[defaults.outputLocale].name })}
        </p>
      ) : (
        <Field label={t("outputLanguage")} hint={t("outputLanguageHint")}>
          <select
            className={`${inputClass} sm:max-w-md`}
            value={value.outputLocale ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                outputLocale: (e.target.value || null) as Locale | null,
              })
            }
          >
            <option value="">
              {t("followOrganization", {
                language: LOCALES[defaults.outputLocale].name,
              })}
            </option>
            {LOCALE_CODES.map((code) => (
              <option key={code} value={code} lang={LOCALES[code].tag}>
                {LOCALES[code].name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <SpokenLanguages value={spoken} onChange={setSpoken} />
    </div>
  );
}

// The languages Soniox should expect, as a list the user adds to and removes from. Names come
// from the browser in the page's language.
export function SpokenLanguages({
  value: spoken,
  onChange: setSpoken,
  label,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const t = useTranslations("languages");
  const nameOf = useLanguageName();
  const addable = SONIOX_LANGUAGES.filter(
    (code) => !spoken.includes(code),
  ).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">
        {label ?? t("spokenLanguages")}
      </legend>
      <p className="text-sm text-muted">{t("spokenLanguagesHint")}</p>
      <ul className="flex flex-wrap gap-2">
        {spoken.map((code) => (
          <li
            key={code}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface pl-3"
          >
            {nameOf(code)}
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-full"
              aria-label={t("removeLanguage", { language: nameOf(code) })}
              disabled={spoken.length === 1}
              onClick={() => setSpoken(spoken.filter((c) => c !== code))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {spoken.length < MAX_TRANSCRIPTION_LANGUAGES && (
        <select
          className={`${inputClass} sm:max-w-xs`}
          value=""
          aria-label={t("addLanguage")}
          onChange={(e) =>
            e.target.value && setSpoken([...spoken, e.target.value])
          }
        >
          <option value="">{t("addLanguage")}</option>
          {addable.map((code) => (
            <option key={code} value={code}>
              {nameOf(code)}
            </option>
          ))}
        </select>
      )}
    </fieldset>
  );
}
