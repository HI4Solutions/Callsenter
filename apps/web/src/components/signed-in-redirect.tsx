"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { API_URL, type Me, signedInDestination } from "@/lib/auth";

// On the login page: someone who is already signed in is sent on to their starting point. The
// login options are shown right away (also without JavaScript); a signed-in user may see them
// for a moment before being sent on.
//
// Skipped when the page shows an error or an invitation (the user must see it), and when it
// was opened with ?neste=: then a page already turned this session away (for example a Vipps
// session on a page that needs BankID), and the user is here to sign in another way.
export function SignedInRedirect({ next, skip }: { next?: string; skip: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (skip || next || !API_URL) return;
    let cancelled = false;
    fetch(`${API_URL}/me`, { credentials: "include" })
      .then(async (res) => (res.ok ? ((await res.json()) as Me) : null))
      .catch(() => null)
      .then((me) => {
        if (!cancelled && me) router.replace(signedInDestination(me));
      });
    return () => {
      cancelled = true;
    };
  }, [next, skip, router]);

  return null;
}
