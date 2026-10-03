-- Transcription in pieces is billed per piece (security and correctness review, October 2026).
--
-- The worker records one usage event per transcribed piece of 15 seconds. Marking the piece
-- lets billing add the pieces of a call together (instead of taking the largest event, which
-- billed a 30-minute call as 15 seconds), and the unique key stops a piece that was
-- transcribed twice (two workers after a lease ran out) from being counted twice.
alter table usage_events add column piece int check (piece >= 0);
create unique index usage_events_piece_key on usage_events (call_id, piece) where piece is not null;
