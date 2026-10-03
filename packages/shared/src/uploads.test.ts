import { describe, expect, it } from "vitest";
import { isUploadSize, MAX_PIECE_BYTES } from "./uploads.ts";

describe("upload sizes", () => {
  it("must be a whole number of bytes, above zero and within the limit", () => {
    expect(isUploadSize(1, MAX_PIECE_BYTES)).toBe(true);
    expect(isUploadSize(MAX_PIECE_BYTES, MAX_PIECE_BYTES)).toBe(true);
    for (const bad of [0, -1, 1.5, MAX_PIECE_BYTES + 1, "100", undefined, null]) expect(isUploadSize(bad, MAX_PIECE_BYTES)).toBe(false);
  });
});
