import { describe, expect, it } from "vitest";
import { canSeeCalls, formatDuration, recordingMime } from "./calls";

describe("calls helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(formatDuration(null)).toBe("–");
  });

  it("shows calls only with the module and a call permission", () => {
    expect(canSeeCalls({ permissions: ["calls.read.own"], modules: ["transcription"] })).toBe(true);
    expect(canSeeCalls({ permissions: ["calls.read.own"], modules: [] })).toBe(false);
    expect(canSeeCalls({ permissions: ["customers.read"], modules: ["transcription"] })).toBe(false);
  });

  it("prefers Opus in WebM and falls back to what Safari records", () => {
    expect(recordingMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(recordingMime((t) => t === "audio/mp4")).toBe("audio/mp4");
  });
});
