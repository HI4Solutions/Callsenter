import Image from "next/image";

// Begge variantene rendres; globals.css viser den som passer til aktiv modus.
export function Logo({ height = 32 }: { height?: number }) {
  const width = Math.round(height * 4);
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
