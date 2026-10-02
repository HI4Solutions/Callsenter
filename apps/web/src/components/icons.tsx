// Line icons for navigation (24×24, 2px stroke, currentColor), drawn for VeriQall.
// Decorative: the label next to them (visible or sr-only) carries the meaning.

const paths = {
  building: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M16 9h2a2 2 0 0 1 2 2v10" />
      <path d="M3 21h18" />
      <path d="M8 7h4M8 11h4M8 15h4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  team: (
    <>
      <circle cx="12" cy="7" r="3" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M7 20a5 5 0 0 1 10 0" />
      <path d="M1.5 19a3.6 3.6 0 0 1 4.5-3.4M22.5 19a3.6 3.6 0 0 0-4.5-3.4" />
    </>
  ),
  message: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" />
      <path d="M8 10h8M8 13h5" />
    </>
  ),
  growth: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 6-6" />
      <path d="M15 8h5v5" />
    </>
  ),
  roles: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.5" />
      <path d="M5.5 17a3.5 3.5 0 0 1 7 0" />
      <path d="M15 10h3M15 14h3" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" />
      <path d="M4 7l11-3a1 1 0 0 1 1.2 1V7" />
      <path d="M16 13.5h.01" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  phone: (
    <>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  contacts: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7.5 17.5a4.5 4.5 0 0 1 9 0" />
    </>
  ),
  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "size-6" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
