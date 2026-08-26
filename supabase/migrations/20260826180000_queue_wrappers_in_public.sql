-- Route queue access through `public`, which PostgREST already exposes.
--
-- The pgmq_public wrappers (20260826170000) are correct but require adding
-- `pgmq_public` to Settings -> API -> Exposed schemas, which a migration cannot
-- do. Rather than depend on a dashboard toggle, these live in `public` — no
-- configuration, works on any Supabase project.
--
-- Access is still worker-only: revoked from anon and authenticated, granted to
-- service_role. A client that could read the queue could read every other
-- user's job payload.

create or replace function public.queue_read(
  queue_name text,
  visibility_seconds integer default 180,
  batch_size integer default 1
)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select * from pgmq.read(queue_name := queue_name, vt := visibility_seconds, qty := batch_size);
end;
$$;

create or replace function public.queue_send(
  queue_name text,
  message jsonb,
  delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare id bigint;
begin
  select * into id from pgmq.send(queue_name := queue_name, msg := message, delay := delay_seconds);
  return id;
end;
$$;

create or replace function public.queue_delete(queue_name text, message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return pgmq.delete(queue_name := queue_name, msg_id := message_id);
end;
$$;

create or replace function public.queue_archive(queue_name text, message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return pgmq.archive(queue_name := queue_name, msg_id := message_id);
end;
$$;

revoke all on function public.queue_read(text, integer, integer) from public, anon, authenticated;
revoke all on function public.queue_send(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.queue_delete(text, bigint) from public, anon, authenticated;
revoke all on function public.queue_archive(text, bigint) from public, anon, authenticated;

grant execute on function public.queue_read(text, integer, integer) to service_role;
grant execute on function public.queue_send(text, jsonb, integer) to service_role;
grant execute on function public.queue_delete(text, bigint) to service_role;
grant execute on function public.queue_archive(text, bigint) to service_role;
