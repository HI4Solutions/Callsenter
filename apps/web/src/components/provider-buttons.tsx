// The login buttons for BankID and Vipps (login page and the customer's confirmation page), in
// each provider's colours with its symbol to the left of the text. The symbols are decorative:
// the text names the provider.
import type { ReactNode } from "react";

// 19 px bold is large text (WCAG), so white on Vipps' orange (about 3.1:1) meets the 3:1 it needs.
export const LOGIN_BUTTON =
  "inline-flex min-h-14 items-center justify-center rounded-xl px-4 text-[1.1875rem] font-bold";
const BASE = `${LOGIN_BUTTON} text-white aria-disabled:pointer-events-none aria-disabled:opacity-60`;

// The symbol and the text, centred in the button as a block of fixed width, so the symbols and the
// texts start at the same place in every button on the page.
export function LoginButtonContent({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="flex w-64 max-w-full items-center gap-4">
      <span className="flex w-8 shrink-0 justify-center">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

// BankID's symbol: the eight bars of its logo (public/brand/bankid-logo.svg).
function BankIdSymbol() {
  return (
    <svg
      viewBox="18 16 87 56"
      width={28}
      height={18}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M38.13 24.7024H22.4443C20.3528 24.7024 18.5228 22.8691 18.5228 20.7738C18.5228 18.6786 20.3528 16.8452 22.4443 16.8452H38.13C40.2214 16.8452 42.0514 18.6786 42.0514 20.7738C42.0514 22.8691 40.2214 24.7024 38.13 24.7024Z" />
      <path d="M38.13 56.131H22.4443C20.3528 56.131 18.5228 54.2976 18.5228 52.2024C18.5228 50.1072 20.3528 48.2738 22.4443 48.2738H38.13C40.2214 48.2738 42.0514 50.1072 42.0514 52.2024C42.0514 54.2976 40.2214 56.131 38.13 56.131Z" />
      <path d="M38.13 71.8452H22.4443C20.3528 71.8452 18.5228 70.0119 18.5228 67.9167C18.5228 65.8214 20.3528 63.9881 22.4443 63.9881H38.13C40.2214 63.9881 42.0514 65.8214 42.0514 67.9167C42.0514 70.0119 40.2214 71.8452 38.13 71.8452Z" />
      <path d="M69.5014 40.4167H53.8157C51.7243 40.4167 49.8943 38.5833 49.8943 36.4881C49.8943 34.3929 51.7243 32.5595 53.8157 32.5595H69.5014C71.5928 32.5595 73.4228 34.3929 73.4228 36.4881C73.4228 38.5833 71.5928 40.4167 69.5014 40.4167Z" />
      <path d="M69.5014 56.131H53.8157C51.7243 56.131 49.8943 54.2976 49.8943 52.2024C49.8943 50.1072 51.7243 48.2738 53.8157 48.2738H69.5014C71.5928 48.2738 73.4228 50.1072 73.4228 52.2024C73.4228 54.2976 71.5928 56.131 69.5014 56.131Z" />
      <path d="M100.873 24.7024H85.1871C83.0957 24.7024 81.2657 22.8691 81.2657 20.7738C81.2657 18.6786 83.0957 16.8452 85.1871 16.8452H100.873C102.964 16.8452 104.794 18.6786 104.794 20.7738C104.794 22.8691 102.964 24.7024 100.873 24.7024Z" />
      <path d="M100.873 40.4167H85.1871C83.0957 40.4167 81.2657 38.5833 81.2657 36.4881C81.2657 34.3929 83.0957 32.5595 85.1871 32.5595H100.873C102.964 32.5595 104.794 34.3929 104.794 36.4881C104.794 38.5833 102.964 40.4167 100.873 40.4167Z" />
      <path d="M100.873 71.8452H85.1871C83.0957 71.8452 81.2657 70.0119 81.2657 67.9167C81.2657 65.8214 83.0957 63.9881 85.1871 63.9881H100.873C102.964 63.9881 104.794 65.8214 104.794 67.9167C104.794 70.0119 102.964 71.8452 100.873 71.8452Z" />
    </svg>
  );
}

// A placeholder for Vipps' symbol until Vipps' official files are in public/brand/ (Vipps does not
// allow its own designs in production; CLAUDE.md, Ikke gjort).
function VippsSymbol() {
  return (
    <svg
      viewBox="40 46 120 100"
      width={22}
      height={18}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="119" cy="68" r="18" fill="currentColor" />
      <path
        d="M 48 100 Q 100 168 152 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="26"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface ProviderButtonProps {
  href: string | undefined;
  disabled?: boolean;
  children: ReactNode;
}

export function BankIdButton({
  href,
  disabled,
  children,
}: ProviderButtonProps) {
  return (
    <a
      href={disabled ? undefined : href}
      aria-disabled={disabled || undefined}
      className={`${BASE} bg-[#39134c]`}
    >
      <LoginButtonContent icon={<BankIdSymbol />}>
        {children}
      </LoginButtonContent>
    </a>
  );
}

export function VippsButton({ href, disabled, children }: ProviderButtonProps) {
  return (
    <a
      href={disabled ? undefined : href}
      aria-disabled={disabled || undefined}
      className={`${BASE} bg-[#ff5b24]`}
    >
      <LoginButtonContent icon={<VippsSymbol />}>{children}</LoginButtonContent>
    </a>
  );
}
