-- pgmq queues. `papercub_generation` holds StoryGenerateJobPayload messages
-- (and other JobType payloads); `papercub_generation_dlq` receives messages
-- after MAX_ATTEMPTS_PER_STAGE read failures (docs/ARCHITECTURE.md: "3 failed
-- reads -> DLQ -> status 'dead_letter', alert").
--
-- pgmq's own tables (pgmq.q_<name> / pgmq.a_<name>) are not exposed via
-- PostgREST and are read/written only by the worker's service-role client, so
-- no RLS policy is needed here — only the durable generation_jobs table
-- (already RLS'd) is client-visible.

select pgmq.create('papercub_generation');
select pgmq.create('papercub_generation_dlq');
