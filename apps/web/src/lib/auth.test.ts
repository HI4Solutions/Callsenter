import { describe, expect, it } from "vitest";
import { LOGIN_ERRORS, loginErrorMessage, loginStartUrl, safeNext } from "./auth";

describe("login helpers", () => {
  it("builds start URLs with invitation and return path", () => {
    expect(loginStartUrl("bankid")).toBe("/auth/bankid/start");
    expect(loginStartUrl("vipps", { invite: "abc", next: "/samtaler?side=2" })).toBe(
      "/auth/vipps/start?invite=abc&next=%2Fsamtaler%3Fside%3D2",
    );
  });

  it("never passes a return path that leaves the app", () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "/a\r\nb", "x"]) {
      expect(safeNext(next)).toBeUndefined();
    }
    expect(safeNext("/innstillinger")).toBe("/innstillinger");
  });

  it("has a Norwegian message for every error code, and a fallback", () => {
    for (const code of ["avbrutt", "utlopt", "ukjent", "invitasjon", "deaktivert", "allerede_koblet", "ikke_satt_opp", "feil"]) {
      expect(LOGIN_ERRORS[code]).toBeTruthy();
    }
    expect(loginErrorMessage("noe_annet")).toBe(LOGIN_ERRORS.feil);
    expect(loginErrorMessage(undefined)).toBeUndefined();
  });
});
