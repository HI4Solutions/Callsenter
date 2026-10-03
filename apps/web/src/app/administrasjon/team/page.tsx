"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { orgFetch, type OrgOverview } from "@/lib/org";

export default function TeamsPage() {
  const [data, setData] = useState<OrgOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const reload = useCallback(
    () =>
      orgFetch<OrgOverview>("/overview")
        .then(setData)
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    orgFetch<OrgOverview>("/overview")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await orgFetch("/teams", { method: "POST", body: { name } });
      setName("");
    });
  }

  if (!data) return <LoadState error={error} />;
  const active = data.teams.filter((t) => !t.archivedAt);
  const archived = data.teams.filter((t) => t.archivedAt);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Team</h1>
        <p className="mt-2 text-muted">Team brukes til å gi ledere innsyn i samtalene og salgene til sine selgere.</p>
      </div>
      <Card title="Nytt team">
        <form onSubmit={create} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field label="Navn">
            <input required maxLength={100} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button type="submit" className={primaryButton}>
            Opprett team
          </button>
        </form>
      </Card>
      <ErrorMessage message={error} />
      <Card title={`Team (${active.length})`}>
        {active.length === 0 ? (
          <p className="text-muted">Ingen team ennå.</p>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((t) => (
              <TeamRow key={t.id} team={t} onRun={run} />
            ))}
          </ul>
        )}
      </Card>
      {archived.length > 0 && (
        <Card title="Arkiverte team">
          <ul className="divide-y divide-line">
            {archived.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <span>{t.name}</span>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => run(() => orgFetch(`/teams/${t.id}`, { method: "PATCH", body: { archived: false } }))}
                >
                  Gjenopprett
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function TeamRow({
  team,
  onRun,
}: {
  team: OrgOverview["teams"][number];
  onRun: (action: () => Promise<unknown>, confirmText?: string) => Promise<void>;
}) {
  const [name, setName] = useState(team.name);
  const changed = name.trim() !== team.name && name.trim().length > 0;
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-end sm:justify-between">
      <Field label={`${team.members} ${team.members === 1 ? "medlem" : "medlemmer"}`}>
        <input maxLength={100} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        {changed && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => onRun(() => orgFetch(`/teams/${team.id}`, { method: "PATCH", body: { name } }))}
          >
            Lagre navn
          </button>
        )}
        <button
          type="button"
          className={secondaryButton}
          onClick={() =>
            onRun(
              () => orgFetch(`/teams/${team.id}`, { method: "PATCH", body: { archived: true } }),
              `Arkivere ${team.name}? Medlemmene blir uten team.`,
            )
          }
        >
          Arkiver
        </button>
      </div>
    </li>
  );
}
