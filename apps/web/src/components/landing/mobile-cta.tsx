"use client";

import { useState } from "react";
import { DemoLink } from "@/components/landing/demo-link";
import { reached, scrolledPast, useScrollFrame } from "@/components/landing/motion";

// On phones: "Be om en demo" in a bar at the bottom once the hero's buttons are scrolled away, and
// gone again when the contact form comes into view. Replaces the chat bubble on small screens.
export function MobileCta() {
  const [show, setShow] = useState(false);
  useScrollFrame(() => setShow(scrolledPast("hero-cta") && !reached("kontakt", 80)));
  return (
    <div
      inert={!show}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] transition-transform duration-300 ease-out motion-reduce:transition-none sm:hidden print:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <DemoLink className="w-full" />
    </div>
  );
}
