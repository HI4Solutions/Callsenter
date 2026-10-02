"use client";

import { useState } from "react";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { formatDateTime } from "@/lib/format";
import { formatPrice, lines, months, priceInput, type RequiredPoint, type TemplateVersion } from "@/lib/work";

// A version as sellers and AI control see it.
export function VersionView({ version }: { version: TemplateVersion }) {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
        {(
          [
            ["Pris", formatPrice(version)],
            ["Bindingstid", months(version.bindingMonths)],
            ["Oppsigelsestid", months(version.noticeMonths)],
            ["Angrefrist", version.withdrawalDays === 0 ? "Ingen" : `${version.withdrawalDays} dager`],
            ...(version.publishedAt
              ? [["Publisert", `${formatDateTime(version.publishedAt)}${version.publishedByName ? ` av ${version.publishedByName}` : ""}`]]
              : []),
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-semibold text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="font-bold">Obligatoriske punkter</h3>
        <p className="text-sm text-muted">Selgeren må si dette i samtalen. AI-kontrollen sjekker hvert punkt.</p>
        {version.requiredPoints.length ? (
          <ol className="mt-2 list-decimal space-y-1 pl-6">
            {version.requiredPoints.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-muted">Ingen.</p>
        )}
      </div>
      <PhraseList title="Godkjente formuleringer" phrases={version.approvedPhrases} />
      <PhraseList title="Forbudte formuleringer" phrases={version.forbiddenPhrases} />
      <div>
        <h3 className="font-bold">Vilkår</h3>
        {version.terms ? (
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-bg p-3">{version.terms}</p>
        ) : (
          <p className="mt-2 text-muted">Ingen vilkår.</p>
        )}
      </div>
    </div>
  );
}

function PhraseList({ title, phrases }: { title: string; phrases: string[] }) {
  return (
    <div>
      <h3 className="font-bold">{title}</h3>
      {phrases.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {phrases.map((p) => (
            <li key={p}>«{p}»</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">Ingen.</p>
      )}
    </div>
  );
}

// The draft editor. Points keep their ids, so AI findings on earlier versions still match.
export function DraftEditor({
  draft,
  onSave,
  onPublish,
  onDelete,
}: {
  draft: TemplateVersion;
  onSave: (body: Record<string, unknown>) => Promise<{ requiredPoints: RequiredPoint[] }>;
  onPublish: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [priceOnce, setPriceOnce] = useState(priceInput(draft.priceOnce));
  const [priceMonthly, setPriceMonthly] = useState(priceInput(draft.priceMonthly));
  const [bindingMonths, setBindingMonths] = useState(String(draft.bindingMonths));
  const [noticeMonths, setNoticeMonths] = useState(String(draft.noticeMonths));
  const [withdrawalDays, setWithdrawalDays] = useState(String(draft.withdrawalDays));
  const [terms, setTerms] = useState(draft.terms);
  const [points, setPoints] = useState<RequiredPoint[]>(draft.requiredPoints);
  const [approved, setApproved] = useState(draft.approvedPhrases.join("\n"));
  const [forbidden, setForbidden] = useState(draft.forbiddenPhrases.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const body = () => ({
    priceOnce: priceOnce.trim() || null,
    priceMonthly: priceMonthly.trim() || null,
    bindingMonths: Number(bindingMonths),
    noticeMonths: Number(noticeMonths),
    withdrawalDays: Number(withdrawalDays),
    terms,
    requiredPoints: points.filter((p) => p.text.trim()),
    approvedPhrases: lines(approved),
    forbiddenPhrases: lines(forbidden),
  });

  async function run(action: () => Promise<void>) {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setSaved(false);
    setter(v);
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          // New points get their ids from the server; keep them so the next save does not renumber.
          setPoints((await onSave(body())).requiredPoints);
          setSaved(true);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Månedspris (kr)" hint="Tom hvis produktet ikke har månedspris.">
          <input inputMode="decimal" className={inputClass} value={priceMonthly} onChange={(e) => edit(setPriceMonthly)(e.target.value)} />
        </Field>
        <Field label="Engangspris (kr)" hint="For eksempel etablering eller utstyr.">
          <input inputMode="decimal" className={inputClass} value={priceOnce} onChange={(e) => edit(setPriceOnce)(e.target.value)} />
        </Field>
        <Field label="Bindingstid (måneder)">
          <input type="number" min={0} max={120} className={inputClass} value={bindingMonths} onChange={(e) => edit(setBindingMonths)(e.target.value)} />
        </Field>
        <Field label="Oppsigelsestid (måneder)">
          <input type="number" min={0} max={24} className={inputClass} value={noticeMonths} onChange={(e) => edit(setNoticeMonths)(e.target.value)} />
        </Field>
        <Field label="Angrefrist (dager)" hint="Minst 14 dager ved telefonsalg til forbrukere.">
          <input type="number" min={0} max={365} className={inputClass} value={withdrawalDays} onChange={(e) => edit(setWithdrawalDays)(e.target.value)} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-bold">Obligatoriske punkter</legend>
        <p className="text-sm text-muted">Det selgeren må si i samtalen, ett punkt per linje. AI-kontrollen sjekker hvert punkt.</p>
        {points.map((p, i) => (
          <div key={p.id || `ny-${i}`} className="flex gap-2">
            <label className="sr-only" htmlFor={`point-${i}`}>
              Punkt {i + 1}
            </label>
            <input
              id={`point-${i}`}
              maxLength={500}
              className={`${inputClass} flex-1`}
              value={p.text}
              onChange={(e) => edit(setPoints)(points.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)))}
            />
            <button type="button" className={secondaryButton} onClick={() => edit(setPoints)(points.filter((_, j) => j !== i))}>
              Fjern<span className="sr-only"> punkt {i + 1}</span>
            </button>
          </div>
        ))}
        <div>
          <button type="button" className={secondaryButton} onClick={() => edit(setPoints)([...points, { id: "", text: "" }])}>
            Legg til punkt
          </button>
        </div>
      </fieldset>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="Godkjente formuleringer" hint="Én per linje. Formuleringer selgeren gjerne kan bruke.">
          <textarea rows={5} className={`${inputClass} py-2`} value={approved} onChange={(e) => edit(setApproved)(e.target.value)} />
        </Field>
        <Field label="Forbudte formuleringer" hint="Én per linje. AI-kontrollen flagger dem.">
          <textarea rows={5} className={`${inputClass} py-2`} value={forbidden} onChange={(e) => edit(setForbidden)(e.target.value)} />
        </Field>
      </div>

      <Field label="Vilkår" hint="Vilkårene kunden godtar. Sendes med bekreftelsen.">
        <textarea rows={10} maxLength={50000} className={`${inputClass} py-2`} value={terms} onChange={(e) => edit(setTerms)(e.target.value)} />
      </Field>

      <ErrorMessage message={error} />
      {saved && (
        <p role="status" className="text-muted">
          Utkastet er lagret.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          Lagre utkast
        </button>
        <button
          type="button"
          disabled={busy}
          className={secondaryButton}
          onClick={() => {
            if (!window.confirm(`Publisere versjon ${draft.version}? Den kan ikke endres etterpå, og nye salg bruker den.`)) return;
            void run(async () => {
              await onSave(body());
              await onPublish();
            });
          }}
        >
          Lagre og publiser
        </button>
        <button
          type="button"
          disabled={busy}
          className={secondaryButton}
          onClick={() => {
            if (window.confirm("Slette utkastet?")) void run(onDelete);
          }}
        >
          Slett utkast
        </button>
      </div>
    </form>
  );
}
