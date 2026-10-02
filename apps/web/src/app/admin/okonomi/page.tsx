"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LAST_SECTION_KEY } from "@/components/billing/economy-nav";

// Økonomi opens the part used last (Forbruk the first time).
export default function EconomyPage() {
  const router = useRouter();
  useEffect(() => {
    let target = "/admin/okonomi/forbruk";
    try {
      const last = localStorage.getItem(LAST_SECTION_KEY);
      if (last && /^\/admin\/okonomi\/(forbruk|stripe|faktura|regnskap)$/.test(last)) target = last;
    } catch {
      // Private mode: the default.
    }
    router.replace(target);
  }, [router]);
  return <p className="text-muted">Laster …</p>;
}
