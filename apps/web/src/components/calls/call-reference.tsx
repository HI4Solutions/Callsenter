"use client";

import { useState } from "react";

// The call's reference number with a button that copies it, for the call centre's own sales
// system. Searching for it under Samtaler finds the call again.
export function CallReference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">Referanse</span>
      <span className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-sm font-semibold tracking-wide">{reference}</span>
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-brand hover:bg-bg"
        onClick={() =>
          navigator.clipboard.writeText(reference).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            },
            () => setCopied(false),
          )
        }
      >
        {copied ? "Kopiert" : "Kopier"}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Referansen er kopiert." : ""}
      </span>
    </span>
  );
}
