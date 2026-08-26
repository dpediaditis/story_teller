-- The worker reads the queue over PostgREST, but Supabase exposes only
-- `public`, `graphql_public` and `storage` by default. `pgmq` is not reachable
-- over the API, so pgmq.read() fails with "Invalid schema: pgmq" even though
-- the queue exists and holds messages.
--
-- Exposing `pgmq` itself would publish every internal queue function. Instead
-- this creates the narrow `pgmq_public` wrapper schema Supabase's own Queues
-- integration uses — the worker already probes for it first.
--
-- One manual step remains and cannot be done from a migration:
--   Dashboard -> Settings -> API -> Exposed schemas -> add `pgmq_public`.

create schema if not exists pgmq_public;

grant usage on schema pgmq_public to service_role;

/** Read up to n messages, hiding them for sleep_seconds (the visibility timeout). */
create or replace function pgmq_public.read(
  queue_name text,
  sleep_seconds integer,
  n integer
)
returns setof pgmq.message_record
language plpgsql
set search_path = ''
as $$
begin
  return query select * from pgmq.read(queue_name := queue_name, vt := sleep_seconds, qty := n);
end;
$$;

/** Enqueue one message. */
create or replace function pgmq_public.send(
  queue_name text,
  message jsonb,
  sleep_seconds integer default 0
)
returns setof bigint
language plpgsql
set search_path = ''
as $$
begin
  return query select * from pgmq.send(queue_name := queue_name, msg := message, delay := sleep_seconds);
end;
$$;

/** Permanently remove a message — the success path. */
create or replace function pgmq_public.delete(
  queue_name text,
  message_id bigint
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  return pgmq.delete(queue_name := queue_name, msg_id := message_id);
end;
$$;

/** Move a message to the archive table rather than dropping it. */
create or replace function pgmq_public.archive(
  queue_name text,
  message_id bigint
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  return pgmq.archive(queue_name := queue_name, msg_id := message_id);
end;
$$;

/** Read-and-delete in one step. */
create or replace function pgmq_public.pop(queue_name text)
returns setof pgmq.message_record
language plpgsql
set search_path = ''
as $$
begin
  return query select * from pgmq.pop(queue_name := queue_name);
end;
$$;

-- Only the worker's role may touch the queue. Never anon or authenticated:
-- a client that can read the queue can read every other user's job payload.
revoke all on function pgmq_public.read(text, integer, integer) from public, anon, authenticated;
revoke all on function pgmq_public.send(text, jsonb, integer) from public, anon, authenticated;
revoke all on function pgmq_public.delete(text, bigint) from public, anon, authenticated;
revoke all on function pgmq_public.archive(text, bigint) from public, anon, authenticated;
revoke all on function pgmq_public.pop(text) from public, anon, authenticated;

grant execute on function pgmq_public.read(text, integer, integer) to service_role;
grant execute on function pgmq_public.send(text, jsonb, integer) to service_role;
grant execute on function pgmq_public.delete(text, bigint) to service_role;
grant execute on function pgmq_public.archive(text, bigint) to service_role;
grant execute on function pgmq_public.pop(text) to service_role;

grant usage on schema pgmq to service_role;
grant select, insert, update, delete on all tables in schema pgmq to service_role;
