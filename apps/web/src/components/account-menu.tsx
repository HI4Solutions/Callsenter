"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL, type Me } from "@/lib/auth";

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
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">
        {state.me.user.name}
        <span className="sr-only">, innlogget med {state.me.provider === "bankid" ? "BankID" : "Vipps"}</span>
      </span>
      <button type="button" onClick={logout} className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold">
        Logg ut
      </button>
    </div>
  );
}
