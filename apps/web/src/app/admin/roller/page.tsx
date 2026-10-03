"use client";

import { DEFAULT_ROLES, isModuleKey, isPermission } from "@veriqall/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage } from "@/components/admin/field";
import { adminFetch, type Catalog } from "@/lib/admin";
import { permissionKey } from "@/lib/format";

export default function RolesAndModulesPage() {
  const t = useTranslations("admin.roles");
  const td = useTranslations("domain");
  const tc = useTranslations("common");
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
        <h1 className="text-3xl font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("intro")}</p>
      </div>
      <ErrorMessage message={error} />
      {!catalog && !error && <p className="text-muted">{tc("loading")}</p>}
      {catalog && (
        <>
          <Card title={t("modules")}>
            <ul className="divide-y divide-line">
              {catalog.modules.map((m) => (
                <li
                  key={m.key}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold">
                      {isModuleKey(m.key)
                        ? td(`modules.${m.key}.name`)
                        : m.name}
                    </p>
                    <p className="text-sm text-muted">
                      {isModuleKey(m.key)
                        ? td(`modules.${m.key}.description`)
                        : m.description}
                    </p>
                  </div>
                  <span className="text-sm">
                    {t("enabledIn", { count: m.enabledIn })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t("defaultRoles")}>
            <div className="-mx-4 scroll-x px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">{t("caption")}</caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      {t("permission")}
                    </th>
                    {catalog.defaultRoles.map((r) => (
                      <th
                        key={r.key}
                        scope="col"
                        className="px-2 py-2 text-center font-semibold"
                      >
                        {r.key in DEFAULT_ROLES
                          ? td(`defaultRoles.${r.key as "seller"}`)
                          : r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catalog.permissions.map((p) => (
                    <tr key={p.key} className="border-b border-line">
                      <th
                        scope="row"
                        className="py-2 pr-4 text-left font-normal"
                      >
                        <span className="block">
                          {isPermission(p.key)
                            ? td(`permissions.${permissionKey(p.key)}`)
                            : p.description}
                        </span>
                        <span className="text-muted">
                          <code>{p.key}</code>
                          {p.requiresBankId && ` · ${t("requiresBankId")}`}
                        </span>
                      </th>
                      {catalog.defaultRoles.map((r) => {
                        const has = r.permissions.includes(p.key);
                        return (
                          <td key={r.key} className="px-2 py-2 text-center">
                            {has ? (
                              <span aria-label={t("yes")}>✓</span>
                            ) : (
                              <span className="sr-only">{t("no")}</span>
                            )}
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
