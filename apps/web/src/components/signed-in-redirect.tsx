"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { API_URL, type Me, signedInDestination } from "@/lib/auth";

// On the login page: someone who is already signed in is sent on instead of seeing the buttons.
// While that is checked nothing is shown, so a signed-in user never sees the login page flash.
// Not when the page shows an error (the user needs to read it).
export function SignedInRedirect({ next, skip, children }: { next?: string; skip: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(skip || !API_URL);

  useEffect(() => {
    if (skip || !API_URL) return;
    let cancelled = false;
    fetch(`${API_URL}/me`, { credentials: "include" })
      .then(async (res) => (res.ok ? ((await res.json()) as Me) : null))
      .catch(() => null)
      .then((me) => {
        if (cancelled) return;
        if (me) router.replace(signedInDestination(me, next));
        else setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [next, skip, router]);

  if (!checked) return <p className="sr-only">Laster …</p>;
  return children;
}
