"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { EmptyState } from "@/components/empty-state";
import { orgFetch, type OrgOverview } from "@/lib/org";

export default function TeamsPage() {
  const t = useTranslations("org.teams");
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
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("intro")}</p>
      </div>
      <Card title={t("new")}>
        <form onSubmit={create} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field label={t("name")}>
            <input required maxLength={100} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button type="submit" className={primaryButton}>
            {t("create")}
          </button>
        </form>
      </Card>
      <ErrorMessage message={error} />
      <Card title={t("list", { count: active.length })}>
        {active.length === 0 ? (
          <EmptyState title={t("empty")}>{t("emptyHint")}</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((team) => (
              <TeamRow key={team.id} team={team} onRun={run} />
            ))}
          </ul>
        )}
      </Card>
      {archived.length > 0 && (
        <Card title={t("archived")}>
          <ul className="divide-y divide-line">
            {archived.map((team) => (
              <li key={team.id} className="flex items-center justify-between gap-3 py-3">
                <span>{team.name}</span>
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => run(() => orgFetch(`/teams/${team.id}`, { method: "PATCH", body: { archived: false } }))}
                >
                  {t("restore")}
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
  const t = useTranslations("org.teams");
  const [name, setName] = useState(team.name);
  const changed = name.trim() !== team.name && name.trim().length > 0;
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-end sm:justify-between">
      <Field label={t("members", { count: team.members })}>
        <input maxLength={100} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        {changed && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => onRun(() => orgFetch(`/teams/${team.id}`, { method: "PATCH", body: { name } }))}
          >
            {t("saveName")}
          </button>
        )}
        <button
          type="button"
          className={secondaryButton}
          onClick={() =>
            onRun(() => orgFetch(`/teams/${team.id}`, { method: "PATCH", body: { archived: true } }), t("confirmArchive", { name: team.name }))
          }
        >
          {t("archive")}
        </button>
      </div>
    </li>
  );
}
