-- ParentAccount — domain.ts. `id` IS auth.users.id, no surrogate key, which is
-- what makes every downstream policy a plain `= auth.uid()` or one join away.

create table public.parent_accounts (
  id               uuid primary key references auth.users (id) on delete cascade,
  email_hash       text null,
  locale           text not null default 'en',
  is_anonymous     boolean not null default true,
  linked_providers public.auth_provider[] not null default array['anonymous']::public.auth_provider[],
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz null
);

comment on column public.parent_accounts.email_hash is
  'SHA-256 of the lowercased email. Set only if the parent opts into receipts.';
comment on column public.parent_accounts.deleted_at is
  'Soft delete. Also used to mark a retired/orphaned uid after keep_account_only merge — purged after RETENTION_DAYS.accountHardDelete.';

alter table public.parent_accounts enable row level security;

create policy "parent_accounts_owner_select" on public.parent_accounts
  for select
  using (id = auth.uid());

create policy "parent_accounts_owner_update" on public.parent_accounts
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- No client insert/delete policy: the row is created by the auth trigger
-- (see handle_new_auth_user below) and never inserted directly by a client.

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
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
