create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  public_slug text not null unique,
  name text not null check (char_length(name) between 1 and 120),
  logo_path text,
  cover_path text,
  phone text,
  address text,
  description text,
  timezone text not null default 'Asia/Ho_Chi_Minh' check (char_length(timezone) between 3 and 64),
  currency text not null default 'VND' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  published_at timestamptz,
  manual_open_state text check (manual_open_state in ('open', 'closed', 'temporarily_closed')),
  delivery_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  min_order_amount bigint not null default 0 check (min_order_amount >= 0),
  default_delivery_fee bigint not null default 0 check (default_delivery_fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_public_slug_format check (
    char_length(public_slug) between 3 and 63
    and public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint stores_public_slug_reserved check (
    public_slug not in ('_nuxt', 'admin', 'api', 'login', 'order', 's')
  )
);

create table public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index organization_members_user_id_idx
  on public.organization_members (user_id, organization_id);

create index stores_organization_id_idx
  on public.stores (organization_id, id);

create index store_members_user_id_idx
  on public.store_members (user_id, store_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.prevent_published_store_slug_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.published_at is not null and new.published_at is null then
    raise exception 'published_at cannot be cleared after publication' using errcode = 'P0001';
  end if;

  if old.published_at is not null and new.public_slug is distinct from old.public_slug then
    raise exception 'public_slug cannot change after publication' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function private.set_updated_at();

create trigger stores_set_updated_at
before update on public.stores
for each row execute function private.set_updated_at();

create trigger stores_prevent_published_slug_change
before update of public_slug, published_at on public.stores
for each row execute function private.prevent_published_store_slug_change();

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;
