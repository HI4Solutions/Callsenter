import { describe, expect, it } from "vitest";
import { loginErrorCode, loginPathFor, loginStartUrl, safeNext, signedInDestination } from "./auth";

describe("login helpers", () => {
  it("builds start URLs with invitation and return path", () => {
    expect(loginStartUrl("bankid")).toBe("/auth/bankid/start");
    expect(loginStartUrl("vipps", { invite: "abc", next: "/samtaler?side=2" })).toBe(
      "/auth/vipps/start?invite=abc&next=%2Fsamtaler%3Fside%3D2",
    );
  });

  it("never passes a return path that leaves the app", () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "/a\r\nb", "/\t/evil.example", "x"]) {
      expect(safeNext(next)).toBeUndefined();
    }
    expect(safeNext("/innstillinger")).toBe("/innstillinger");
  });

  it("knows the API's error codes, with a fallback (texts in messages/<locale>/login.json)", () => {
    for (const code of ["avbrutt", "utlopt", "ukjent", "invitasjon", "deaktivert", "allerede_koblet", "navn_ulikt", "ikke_satt_opp", "feil"]) {
      expect(loginErrorCode(code)).toBe(code);
    }
    expect(loginErrorCode("noe_annet")).toBe("feil");
    expect(loginErrorCode(undefined)).toBeUndefined();
  });
});

describe("where a signed-in user lands", () => {
  const base = { platformAdmin: false, permissions: [] as string[] };
  it("picks the starting point by access", () => {
    expect(signedInDestination({ ...base, platformAdmin: true })).toBe("/admin");
    expect(signedInDestination({ ...base, permissions: ["users.manage"] })).toBe("/administrasjon");
    expect(signedInDestination({ ...base, permissions: ["calls.upload", "sales.manage"], modules: ["transcription"] })).toBe("/samtaler");
    expect(signedInDestination({ ...base, permissions: ["calls.upload", "sales.manage"], modules: [] })).toBe("/salg");
    expect(signedInDestination({ ...base, permissions: ["customers.read", "sales.manage"] })).toBe("/salg");
    expect(signedInDestination({ ...base, permissions: ["customers.read"] })).toBe("/kunder");
    expect(signedInDestination(base)).toBe("/konto");
  });
});

describe("sending signed-out visitors to login", () => {
  it("returns them to the page they tried to open", () => {
    expect(loginPathFor("/admin/brukere")).toBe("/logg-inn?neste=%2Fadmin%2Fbrukere");
    expect(loginPathFor("/")).toBe("/logg-inn");
    expect(loginPathFor("//evil.example")).toBe("/logg-inn");
  });
});
