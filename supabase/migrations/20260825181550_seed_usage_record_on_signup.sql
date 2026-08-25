-- Extends handle_new_auth_user (20260825180100) to also open the free tier's
-- one, never-renewing usage_records row. Deferred to this migration because
-- usage_records did not exist yet when parent_accounts was created.
--
-- Free tier: period_end IS NULL, exactly one row, never rolls over
-- (docs/ARCHITECTURE.md: "Free tier is one-off ... there is no reset job").
-- A later transition to `family` is handled by apply_revenuecat_event, which
-- opens a second, period-bounded row without touching this one.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.parent_accounts (id, is_anonymous, linked_providers)
  values (
    new.id,
    coalesce(new.is_anonymous, true),
    case when coalesce(new.is_anonymous, true)
      then array['anonymous']::public.auth_provider[]
      else array[]::public.auth_provider[]
    end
  )
  on conflict (id) do nothing;

  insert into public.usage_records (parent_id, period_start, period_end)
  values (new.id, now(), null)
  on conflict do nothing;

  return new;
end;
$$;
