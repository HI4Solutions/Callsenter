// The browser records WebM without a duration in its header: MediaRecorder streams the file and
// never goes back to write it. Players then show the length as unknown, and the timeline on the
// call page cannot be used. When the worker joins the chunks of a recording, it writes the call's
// duration into the header (the Duration element in the segment's Info), which is in the first
// chunk. Anything it does not recognise is left exactly as it was.

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const CLUSTER = 0x1f43b675;
const SEEK_HEAD = 0x114d9b74;

interface Element {
  id: number;
  start: number;
  // Where the size field starts and how long it is.
  sizeStart: number;
  sizeLength: number;
  size: number;
  dataStart: number;
  // Exclusive; the end of the data for an element of unknown size.
  end: number;
  unknownSize: boolean;
}

// The length of a variable-size integer from its first byte (1 for 1xxxxxxx, 2 for 01xxxxxx …).
function vintLength(first: number, max: number): number {
  for (let length = 1, mask = 0x80; length <= max; length++, mask >>= 1) {
    if (first & mask) return length;
  }
  return 0;
}

function readElement(bytes: Uint8Array, pos: number): Element | null {
  const idLength = vintLength(bytes[pos] ?? 0, 4);
  if (!idLength || pos + idLength > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[pos + i]!;
  const sizeStart = pos + idLength;
  const sizeLength = vintLength(bytes[sizeStart] ?? 0, 8);
  if (!sizeLength || sizeStart + sizeLength > bytes.length) return null;
  const marker = 0x80 >> (sizeLength - 1);
  let size = bytes[sizeStart]! & (marker - 1);
  let unknownSize = size === marker - 1;
  for (let i = 1; i < sizeLength; i++) {
    const b = bytes[sizeStart + i]!;
    size = size * 256 + b;
    if (b !== 0xff) unknownSize = false;
  }
  const dataStart = sizeStart + sizeLength;
  const end = unknownSize ? bytes.length : dataStart + size;
  if (end > bytes.length) return null;
  return { id, start: pos, sizeStart, sizeLength, size, dataStart, end, unknownSize };
}

function idBytes(id: number): Uint8Array {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return Uint8Array.from(out);
}

// A size in 8 bytes, which fits any size (Info's, which may grow).
function sizeBytes(size: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7, v = size; i >= 1; i--, v = Math.floor(v / 256)) out[i] = v % 256;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// The recording with its duration in the header, or the bytes unchanged when they are not a WebM
// file this understands.
export function withDuration(bytes: Uint8Array, durationMs: number): Uint8Array {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return bytes;
  const header = readElement(bytes, 0);
  if (!header || header.id !== EBML_HEADER || header.unknownSize) return bytes;
  const segment = readElement(bytes, header.end);
  if (!segment || segment.id !== SEGMENT) return bytes;

  // The segment's elements before the first cluster. A SeekHead points at positions that would
  // move, so a file with one is left alone (MediaRecorder does not write one).
  let info: Element | null = null;
  for (let pos = segment.dataStart; pos < segment.end; ) {
    const el = readElement(bytes, pos);
    if (!el || el.id === SEEK_HEAD) return bytes;
    if (el.id === CLUSTER) break;
    if (el.id === INFO) {
      info = el;
      break;
    }
    if (el.unknownSize) return bytes;
    pos = el.end;
  }
  if (!info || info.unknownSize) return bytes;

  // Info's elements: all are kept except an old Duration. Durations are counted in the timecode
  // scale, in nanoseconds (1 ms unless the file says otherwise).
  let scale = 1_000_000;
  const kept: Uint8Array[] = [];
  for (let pos = info.dataStart; pos < info.end; ) {
    const el = readElement(bytes, pos);
    if (!el || el.unknownSize || el.end > info.end) return bytes;
    if (el.id === TIMECODE_SCALE) {
      let value = 0;
      for (let i = el.dataStart; i < el.end; i++) value = value * 256 + bytes[i]!;
      if (value > 0) scale = value;
    }
    if (el.id !== DURATION) kept.push(bytes.subarray(el.start, el.end));
    pos = el.end;
  }
  const duration = new Uint8Array(8);
  new DataView(duration.buffer).setFloat64(0, (durationMs * 1_000_000) / scale);
  const children = concat([...kept, idBytes(DURATION), Uint8Array.of(0x88), duration]);
  const newInfo = concat([idBytes(INFO), sizeBytes(children.length), children]);
  const out = concat([bytes.subarray(0, info.start), newInfo, bytes.subarray(info.end)]);

  // A segment of known size grows by as much as Info did; its size field keeps its length.
  if (!segment.unknownSize) {
    const size = segment.size + newInfo.length - (info.end - info.start);
    if (size >= 2 ** (7 * segment.sizeLength) - 1) return bytes;
    const marker = 0x80 >> (segment.sizeLength - 1);
    for (let i = segment.sizeLength - 1, v = size; i >= 0; i--, v = Math.floor(v / 256)) {
      out[segment.sizeStart + i] = i === 0 ? marker | v % 256 : v % 256;
    }
  }
  return out;
}
