"use client";

import { useEffect, useState } from "react";
import { adminFetch, type OrganizationSummary } from "@/lib/admin";
import type { BillingPackage, BillingSettings } from "@/lib/billing";

export function osloToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
}

// Loads what the forms need: call centres, packages and the settings (invoice fee, due days).
export function useInvoiceForm() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      adminFetch<OrganizationSummary[]>("/organizations"),
      adminFetch<BillingPackage[]>("/billing/packages"),
      adminFetch<BillingSettings>("/billing/settings"),
    ])
      .then(([o, p, s]) => {
        if (cancelled) return;
        setOrganizations(o);
        setPackages(p);
        setSettings(s);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);
  return { organizations, packages, settings, error };
}

