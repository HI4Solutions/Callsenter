"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { API_URL, type Me } from "@/lib/auth";
import { switchOrganization } from "@/lib/org";
import { canSeeCalls } from "@/lib/calls";
import { canSeeSales } from "@/lib/work";

type State = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; me: Me };

// Shows who is signed in. The session cookie lives on the API host, so /me is called with
// credentials; the API only allows this app's origin (CORS).
export function AccountMenu() {
  const router = useRouter();
  // Customers confirming a sale are not users: no login or account links on their pages.
  const customerPage = usePathname().startsWith("/bekreft");
  const [state, setState] = useState<State>(API_URL ? { status: "loading" } : { status: "signed-out" });

  useEffect(() => {
    if (!API_URL || customerPage) return;
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
  }, [customerPage]);

  async function logout() {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setState({ status: "signed-out" });
    router.push("/logg-inn");
  }

  if (customerPage || state.status === "loading") return <span className="min-h-11" aria-hidden />;
  if (state.status === "signed-out") {
    return (
      <div className="flex items-center gap-2">
        <Link href="/logg-inn" className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold">
          Logg inn
        </Link>
        <ThemeToggle />
      </div>
    );
  }
  const { me } = state;
  // The call centre's daily work starts at the first page the member can use.
  const work = canSeeCalls(me)
    ? "/samtaler"
    : canSeeSales(me.permissions)
      ? "/salg"
      : me.permissions.includes("customers.read")
        ? "/kunder"
        : "/produkter";
  async function changeOrganization(id: string) {
    try {
      await switchOrganization(id);
      // A full reload, so every page picks up the new call centre.
      window.location.reload();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  const linkClass = "inline-flex min-h-11 items-center rounded-lg px-3 font-semibold hover:bg-bg";
  // The portals the member can use: the call centre's work, its administration, and superadmin.
  const portals = [
    me.activeOrganizationId && { href: work, label: "Callsenter" },
    me.permissions.includes("users.manage") && { href: "/administrasjon", label: "Administrasjon" },
    me.platformAdmin && { href: "/admin", label: "Superadmin" },
  ].filter((p): p is { href: string; label: string } => Boolean(p));
  const orgPicker = me.organizations.length > 1 && (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Callsenter</span>
      <select
        className="min-h-11 w-full rounded-lg border border-line bg-surface px-2"
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
  );

  return (
    <>
      {/* From a medium screen: everything on one row. */}
      <div className="hidden items-center gap-2 lg:flex">
        {orgPicker}
        {portals.length > 1 &&
          portals.map((p) => (
            <Link key={p.href} href={p.href} className={linkClass}>
              {p.label}
            </Link>
          ))}
        <Link href="/konto" className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm hover:bg-bg">
          {me.user.name}
          <span className="sr-only">, min konto</span>
        </Link>
        <button type="button" onClick={logout} className={`${linkClass} whitespace-nowrap`}>
          Logg ut
        </button>
        <ThemeToggle />
      </div>
      {/* Smaller screens: one button that opens the same choices. */}
      <MobileMenu name={me.user.name}>
        {orgPicker}
        {portals.length > 1 &&
          portals.map((p) => (
            <Link key={p.href} href={p.href} className={linkClass}>
              {p.label}
            </Link>
          ))}
        <Link href="/konto" className={linkClass}>
          Min konto
        </Link>
        <div className="px-3 py-2">
          <ThemeToggle />
        </div>
        <button type="button" onClick={logout} className={`${linkClass} text-left`}>
          Logg ut
        </button>
      </MobileMenu>
    </>
  );
}

function MobileMenu({ name, children }: { name: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Closes on navigation, a click outside and Escape.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div ref={ref} className="relative lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 font-semibold"
      >
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand text-sm text-on-brand" aria-hidden="true">
          {initials || "?"}
        </span>
        Meny
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 flex w-64 flex-col gap-1 rounded-xl border border-line bg-surface p-2 shadow-lg">
          <p className="px-3 py-2 text-sm text-muted [overflow-wrap:anywhere]">{name}</p>
          {children}
        </div>
      )}
    </div>
  );
}
