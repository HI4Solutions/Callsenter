"use client";

import { useEffect } from "react";

// Sets the browser tab title from a client component, and keeps it: Next resets the title to the
// app's default on navigation, sometimes after this component has rendered. Used where the title
// may only appear once access is confirmed (the portals), not in static metadata. Leaving the
// portal restores the previous title, since Next does not rewrite an unchanged default title.
export function usePageTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title === title) document.title = previous;
    };
  }, [title]);
}
