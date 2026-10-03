"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton, LoadState } from "@/components/admin/field";
import { DraftEditor, VersionView } from "@/components/work/template-version";
import { useWorkMe } from "@/components/work/work-shell";
import { formatDate, formatDateTime } from "@/lib/format";
import { orgFetch } from "@/lib/org";
import { formatPrice, type ProductDetail, VERSION_STATUS } from "@/lib/work";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const me = useWorkMe();
  const canManage = me?.permissions.includes("products.manage") ?? false;
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownVersion, setShownVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      orgFetch<ProductDetail>(`/products/${id}`)
        .then(setProduct)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    orgFetch<ProductDetail>(`/products/${id}`)
      .then((p) => !cancelled && setProduct(p))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!product) return <LoadState error={error} />;
  const draft = product.versions.find((v) => v.status === "draft");
  const published = product.versions.find((v) => v.status === "published");
  const history = product.versions.filter((v) => v.status !== "draft");
  const older = history.find((v) => v.id === shownVersion && v.status === "retired");

  return (
    <section className="flex flex-col gap-8">
      <div>
        <Link href="/produkter" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">
          ← Alle produkter
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{product.name}</h1>
        {product.description && <p className="mt-2 text-muted">{product.description}</p>}
        {product.archivedAt && <p className="mt-2 text-muted">Arkivert {formatDate(product.archivedAt)}. Kan ikke brukes i nye salg.</p>}
      </div>
      <ErrorMessage message={error} />

      {canManage && draft && (
        <Card title={`Utkast til versjon ${draft.version}`}>
          <p className="mb-6 text-muted">
            {published
              ? `Versjon ${published.version} gjelder til utkastet publiseres.`
              : "Produktet kan ikke brukes i salg før en versjon er publisert."}{" "}
            En publisert versjon kan aldri endres; salg og samtaler peker på versjonen som gjaldt.
          </p>
          <DraftEditor
            key={draft.id}
            draft={draft}
            onSave={(body) => orgFetch(`/products/${id}/versions/${draft.id}`, { method: "PATCH", body })}
            onPublish={async () => {
              await orgFetch(`/products/${id}/versions/${draft.id}/publish`, { method: "POST" });
              await load();
            }}
            onDelete={async () => {
              await orgFetch(`/products/${id}/versions/${draft.id}`, { method: "DELETE" });
              await load();
            }}
          />
        </Card>
      )}

      {published ? (
        <Card
          title={`Gjeldende mal, versjon ${published.version}`}
          actions={
            canManage &&
            !draft && (
              <button
                type="button"
                disabled={busy}
                className={primaryButton}
                onClick={() => run(() => orgFetch(`/products/${id}/draft`, { method: "POST" }))}
              >
                Endre malen
              </button>
            )
          }
        >
          <VersionView version={published} />
        </Card>
      ) : (
        !draft && (
          <Card title="Ingen gjeldende mal">
            <p className="text-muted">Produktet har ingen publisert versjon.</p>
            {canManage && (
              <button
                type="button"
                disabled={busy}
                className={`${primaryButton} mt-4`}
                onClick={() => run(() => orgFetch(`/products/${id}/draft`, { method: "POST" }))}
              >
                Lag utkast
              </button>
            )}
          </Card>
        )
      )}

      {history.length > 1 && (
        <Card title="Versjoner">
          <ul className="divide-y divide-line">
            {history.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-semibold">Versjon {v.version}</span>
                  <span className="ml-2 text-sm text-muted">
                    {VERSION_STATUS[v.status]} · {formatPrice(v)} · publisert {formatDateTime(v.publishedAt)}
                  </span>
                </span>
                {v.status === "retired" && (
                  <button type="button" className={secondaryButton} onClick={() => setShownVersion(shownVersion === v.id ? null : v.id)}>
                    {shownVersion === v.id ? "Skjul" : "Vis"}
                    <span className="sr-only"> versjon {v.version}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {older && (
            <div className="mt-6 border-t border-line pt-6">
              <h3 className="mb-4 text-lg font-bold">Versjon {older.version}</h3>
              <VersionView version={older} />
            </div>
          )}
        </Card>
      )}

      {canManage && <ProductSettings product={product} onRun={run} />}
    </section>
  );
}

function ProductSettings({ product, onRun }: { product: ProductDetail; onRun: (action: () => Promise<unknown>) => Promise<void> }) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const changed = name.trim() !== product.name || description.trim() !== (product.description ?? "");
  return (
    <Card title="Produkt">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onRun(() => orgFetch(`/products/${product.id}`, { method: "PATCH", body: { name, description: description || null } }));
        }}
      >
        <Field label="Navn">
          <input required maxLength={200} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Beskrivelse">
          <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={!changed} className={primaryButton}>
            Lagre
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              if (product.archivedAt || window.confirm(`Arkivere ${product.name}? Det kan ikke brukes i nye salg.`)) {
                void onRun(() => orgFetch(`/products/${product.id}`, { method: "PATCH", body: { archived: !product.archivedAt } }));
              }
            }}
          >
            {product.archivedAt ? "Gjenopprett" : "Arkiver"}
          </button>
        </div>
      </form>
    </Card>
  );
}
