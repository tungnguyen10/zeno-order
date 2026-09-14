create or replace function private.is_organization_admin(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = (select auth.uid())
      and member.role in ('owner', 'admin')
  );
$$;

create or replace function private.has_store_role(p_store_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.stores store
    where store.id = p_store_id
      and (
        private.is_organization_admin(store.organization_id)
        or exists (
          select 1
          from public.store_members member
          where member.store_id = store.id
            and member.user_id = (select auth.uid())
            and member.role = any(p_roles)
        )
      )
  );
$$;

revoke all on function private.is_organization_admin(uuid) from public;
revoke all on function private.has_store_role(uuid, text[]) from public;
grant execute on function private.is_organization_admin(uuid) to authenticated;
grant execute on function private.has_store_role(uuid, text[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;

create policy organizations_select_admin
on public.organizations
for select
to authenticated
using (private.is_organization_admin(id));

create policy organization_members_select_member
on public.organization_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.is_organization_admin(organization_id)
);

create policy stores_select_member
on public.stores
for select
to authenticated
using (private.has_store_role(id, array['owner', 'manager', 'staff']));

create policy store_members_select_member
on public.store_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.has_store_role(store_id, array['owner', 'manager', 'staff'])
);

grant select on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant select on public.stores to authenticated;
grant select on public.store_members to authenticated;

create or replace function public.get_public_store_by_slug(p_public_slug text)
returns table (
  public_slug text,
  name text,
  description text,
  logo_path text,
  timezone text,
  currency text
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    store.public_slug,
    store.name,
    store.description,
    store.logo_path,
    store.timezone,
    store.currency
  from public.stores store
  where store.public_slug = p_public_slug
    and store.is_active = true
    and store.published_at is not null
  limit 1;
$$;

revoke all on function public.get_public_store_by_slug(text) from public;
grant execute on function public.get_public_store_by_slug(text) to anon, authenticated;

