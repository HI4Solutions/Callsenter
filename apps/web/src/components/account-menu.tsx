"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL, type Me } from "@/lib/auth";
import { switchOrganization } from "@/lib/org";

type State = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; me: Me };

// Shows who is signed in. The session cookie lives on the API host, so /me is called with
// credentials; the API only allows this app's origin (CORS).
export function AccountMenu() {
  const router = useRouter();
  const [state, setState] = useState<State>(API_URL ? { status: "loading" } : { status: "signed-out" });

  useEffect(() => {
    if (!API_URL) return;
    let cancelled = false;
    fetch(`${API_URL}/me`, { credentials: "include" })
      .then(async (res) => (res.ok ? ((await res.json()) as Me) : null))
      .catch(() => null)
      .then((me) => {
        if (!cancelled) setState(me ? { status: "signed-in", me } : { status: "signed-out" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setState({ status: "signed-out" });
    router.push("/logg-inn");
  }

  if (state.status === "loading") return <span className="min-h-11" aria-hidden />;
  if (state.status === "signed-out") {
    return (
      <Link href="/logg-inn" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold">
        Logg inn
      </Link>
    );
  }
  const { me } = state;
  async function changeOrganization(id: string) {
    try {
      await switchOrganization(id);
      // A full reload, so every page picks up the new call centre.
      window.location.reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {me.organizations.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Callsenter</span>
          <select
            className="min-h-11 rounded-lg border border-line bg-surface px-2"
            value={me.activeOrganizationId ?? ""}
            onChange={(e) => changeOrganization(e.target.value)}
          >
            {!me.activeOrganizationId && <option value="">Velg callsenter</option>}
            {me.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {me.permissions.includes("users.manage") && (
        <Link href="/administrasjon" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold">
          Administrasjon
        </Link>
      )}
      {state.me.platformAdmin && (
        <Link href="/admin" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold">
          Superadmin
        </Link>
      )}
      <Link href="/konto" className="inline-flex min-h-11 items-center text-sm">
        {state.me.user.name}
        <span className="sr-only">, min konto</span>
      </Link>
      <button type="button" onClick={logout} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 font-semibold">
        Logg ut
      </button>
    </div>
  );
}
