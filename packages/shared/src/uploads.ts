// Size limits for audio uploads. The API signs the size into each upload URL, so S3 refuses a
// file of another size, and the worker never has to read more than it can hold in memory.

const MB = 1024 * 1024;

// One chunk while recording, or a whole audio file uploaded at once.
export const MAX_CHUNK_BYTES = 200 * MB;
// A piece for transcription while recording (about 15 seconds).
export const MAX_PIECE_BYTES = 10 * MB;
// All chunks of one call together, as joined by the worker.
export const MAX_RECORDING_BYTES = 300 * MB;

export function isUploadSize(size: unknown, max: number): size is number {
  return typeof size === "number" && Number.isInteger(size) && size > 0 && size <= max;
}
