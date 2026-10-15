import { describe, expect, it } from "vitest";
import { withDuration } from "../src/calls/webm.ts";

// A small WebM file in the shape MediaRecorder writes: an EBML header, then a segment of unknown
// size with Info, Tracks and a cluster of unknown size.
const bytes = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const element = (id: number[], ...data: (number[] | Uint8Array)[]) => {
  const body = bytes(...data);
  return bytes(id, [0x80 | body.length], body);
};
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const float = (value: number) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
};

const ebmlHeader = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], [...new TextEncoder().encode("webm")]));
const scale = (ns: number) => element([0x2a, 0xd7, 0xb1], [(ns >> 16) & 0xff, (ns >> 8) & 0xff, ns & 0xff]);
const app = element([0x4d, 0x80], [...new TextEncoder().encode("Chrome")]);
const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], element([0xd7], [1])));
const cluster = bytes([0x1f, 0x43, 0xb6, 0x75], UNKNOWN, element([0xe7], [0]), element([0xa3], [0x81, 0, 0, 0x80, 1, 2, 3]));
const recording = (info: Uint8Array, segmentSize: number[] = UNKNOWN) =>
  bytes(ebmlHeader, [0x18, 0x53, 0x80, 0x67], segmentSize, info, tracks, cluster);
const info = (...children: Uint8Array[]) => element([0x15, 0x49, 0xa9, 0x66], ...children);

// The Duration in the file's Info, in milliseconds, and how many there are.
function durations(file: Uint8Array): number[] {
  const found: number[] = [];
  for (let i = 0; i + 11 <= file.length; i++) {
    if (file[i] === 0x44 && file[i + 1] === 0x89 && file[i + 2] === 0x88) {
      found.push(new DataView(file.buffer, file.byteOffset + i + 3, 8).getFloat64(0));
    }
  }
  return found;
}

describe("the recording's duration in the WebM header", () => {
  it("is added to Info, and the rest of the file stays exactly as it was", () => {
    const original = recording(info(scale(1_000_000), app));
    const fixed = withDuration(original, 39_850);
    expect(durations(fixed)).toEqual([39_850]);
    // Info is the only part that changed: what came before and after it is the same.
    const before = ebmlHeader.length + 4 + UNKNOWN.length;
    expect(fixed.subarray(0, before)).toEqual(original.subarray(0, before));
    expect(fixed.subarray(fixed.length - tracks.length - cluster.length)).toEqual(bytes(tracks, cluster));
  });

  it("can be written into the first chunk alone, which holds the header", () => {
    const whole = recording(info(scale(1_000_000), app));
    const first = withDuration(whole.subarray(0, whole.length - 5), 12_345);
    expect(bytes(first, whole.subarray(whole.length - 5))).toEqual(withDuration(whole, 12_345));
  });

  it("replaces a duration that is already there, counted in the file's timecode scale", () => {
    // 0.5 ms per tick: 1 000 ms is 2 000 ticks.
    const fixed = withDuration(recording(info(scale(500_000), element([0x44, 0x89], float(10)), app)), 1_000);
    expect(durations(fixed)).toEqual([2_000]);
  });

  it("grows a segment of known size by as much as Info grew", () => {
    const content = bytes(info(scale(1_000_000), app), tracks, cluster);
    const original = recording(info(scale(1_000_000), app), [0x40 | (content.length >> 8), content.length & 0xff]);
    const fixed = withDuration(original, 5_000);
    const sizeAt = ebmlHeader.length + 4;
    const size = ((fixed[sizeAt]! & 0x3f) << 8) | fixed[sizeAt + 1]!;
    expect(size).toBe(fixed.length - sizeAt - 2);
    expect(durations(fixed)).toEqual([5_000]);
  });

  it("leaves anything it does not understand alone", () => {
    const seekHead = element([0x11, 0x4d, 0x9b, 0x74], element([0x4d, 0xbb], [0]));
    const withSeekHead = bytes(ebmlHeader, [0x18, 0x53, 0x80, 0x67], UNKNOWN, seekHead, info(app), tracks, cluster);
    const truncated = recording(info(scale(1_000_000), app)).subarray(0, ebmlHeader.length + 10);
    for (const file of [new Uint8Array(), new TextEncoder().encode("del1-del2"), withSeekHead, truncated]) {
      expect(withDuration(file, 1_000)).toBe(file);
    }
    const ok = recording(info(app));
    expect(withDuration(ok, 0)).toBe(ok);
    expect(withDuration(ok, Number.NaN)).toBe(ok);
  });
});
