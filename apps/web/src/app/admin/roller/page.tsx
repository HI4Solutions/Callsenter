"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage } from "@/components/admin/field";
import { adminFetch, type Catalog } from "@/lib/admin";

export default function RolesAndModulesPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<Catalog>("/catalog")
      .then((c) => !cancelled && setCatalog(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Roller og moduler</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Rettighetene er faste i koden. Hvert callsenter får standardrollene under når det opprettes, og admin i callsenteret
          kan endre dem og lage nye. Moduler slås av og på per callsenter under Callsentre.
        </p>
      </div>
      <ErrorMessage message={error} />
      {!catalog && !error && <p className="text-muted">Laster …</p>}
      {catalog && (
        <>
          <Card title="Moduler">
            <ul className="divide-y divide-line">
              {catalog.modules.map((m) => (
                <li key={m.key} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-sm text-muted">{m.description}</p>
                  </div>
                  <span className="text-sm">
                    På i {m.enabledIn} {m.enabledIn === 1 ? "callsenter" : "callsentre"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Standardroller og rettigheter">
            <div className="-mx-4 scroll-x px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">Rettigheter per standardrolle</caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Rettighet
                    </th>
                    {catalog.defaultRoles.map((r) => (
                      <th key={r.key} scope="col" className="px-2 py-2 text-center font-semibold">
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catalog.permissions.map((p) => (
                    <tr key={p.key} className="border-b border-line">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">
                        <span className="block">{p.description}</span>
                        <span className="text-muted">
                          <code>{p.key}</code>
                          {p.requiresBankId && " · krever BankID"}
                        </span>
                      </th>
                      {catalog.defaultRoles.map((r) => {
                        const has = r.permissions.includes(p.key);
                        return (
                          <td key={r.key} className="px-2 py-2 text-center">
                            {has ? <span aria-label="Ja">✓</span> : <span className="sr-only">Nei</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </section>
  );
}
