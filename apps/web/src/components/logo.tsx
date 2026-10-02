import Image from "next/image";

// Intrinsic size of the wordmark SVGs in public/brand/.
const LOGO_ASPECT = 203 / 48;

// Both variants are rendered; globals.css shows the one that matches the active theme.
export function Logo({ height = 32 }: { height?: number }) {
  const width = Math.round(height * LOGO_ASPECT);
  return (
    <>
      <Image
        className="logo-light"
        src="/brand/veriqall-logo-light.svg"
        alt="VeriQall"
        width={width}
        height={height}
        unoptimized
        priority
      />
      <Image
        className="logo-dark"
        src="/brand/veriqall-logo-dark.svg"
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        unoptimized
        priority
      />
    </>
  );
}
