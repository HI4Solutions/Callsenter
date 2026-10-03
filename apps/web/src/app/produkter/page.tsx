"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import {
  ErrorMessage,
  Field,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/components/admin/field";
import { useWorkMe } from "@/components/work/work-shell";
import { EmptyState } from "@/components/empty-state";
import { orgFetch } from "@/lib/org";
import { formatPrice, months, type ProductSummary } from "@/lib/work";

export default function ProductsPage() {
  const me = useWorkMe();
  const router = useRouter();
  const t = useTranslations("products");
  const tw = useTranslations("work");
  const tc = useTranslations("common");
  const canManage = me?.permissions.includes("products.manage") ?? false;
  const [archived, setArchived] = useState(false);
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    orgFetch<ProductSummary[]>(`/products${archived ? "?archived=1" : ""}`)
      .then((rows) => {
        if (cancelled) return;
        setProducts(rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [archived]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await orgFetch<{ id: string }>("/products", {
        method: "POST",
        body: { name, description: description || null },
      });
      // Stays busy until the product page has loaded, so a second click cannot create it twice.
      router.push(`/produkter/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // Sellers only see products they can sell; managers also see drafts in progress.
  const shown = products?.filter(
    (p) => canManage || p.publishedVersion !== null,
  );

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-2 text-muted">{t("intro")}</p>
        </div>
        {canManage && !creating && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => setCreating(true)}
          >
            {t("new")}
          </button>
        )}
      </div>

      {creating && (
        <Card title={t("new")}>
          <form onSubmit={create} className="flex flex-col gap-4">
            <Field label={t("name")}>
              <input
                required
                maxLength={200}
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t("description")} hint={t("descriptionHint")}>
              <textarea
                rows={2}
                maxLength={2000}
                className={`${inputClass} py-2`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={primaryButton}>
                {t("createSubmit")}
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setCreating(false)}
              >
                {tw("cancel")}
              </button>
            </div>
          </form>
        </Card>
      )}

      {canManage && (
        <label className="inline-flex min-h-11 items-center gap-2 self-start">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t("showArchived")}
        </label>
      )}
      <ErrorMessage message={error} />
      {!shown ? (
        !error && <p className="text-muted">{tc("loading")}</p>
      ) : shown.length === 0 ? (
        <EmptyState title={archived ? t("emptyArchived") : t("emptyTitle")}>
          {!archived && (canManage ? t("emptyManage") : t("emptyView"))}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {shown.map((p) => (
            <li key={p.id}>
              <Link
                href={`/produkter/${p.id}`}
                className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  <span className="font-semibold">{p.name}</span>
                  {p.archivedAt && (
                    <span className="ml-2 text-sm text-muted">
                      {t("archived")}
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted">
                  {p.publishedVersion !== null
                    ? `${formatPrice(p)} · ${p.bindingMonths ? t("binding", { months: months(p.bindingMonths) }) : t("noBinding")} · ${t("listVersion", { version: p.publishedVersion })}`
                    : t("notPublished")}
                  {canManage &&
                    p.draftVersion !== null &&
                    ` · ${t("draftFor", { version: p.draftVersion })}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
