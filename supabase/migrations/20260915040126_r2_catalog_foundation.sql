create table public.store_hours (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  open_time time,
  close_time time,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint store_hours_one_row_per_day unique (store_id, day_of_week),
  constraint store_hours_valid_interval check (
    (is_closed and open_time is null and close_time is null)
    or
    (not is_closed and open_time is not null and close_time is not null and open_time < close_time)
  )
);

create table public.menus (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menus_store_id_id_key unique (store_id, id)
);

create table public.menu_sections (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  menu_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null,
  description text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_sections_slug_format check (
    char_length(slug) between 1 and 63
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint menu_sections_store_menu_slug_key unique (store_id, menu_id, slug),
  constraint menu_sections_store_menu_id_key unique (store_id, menu_id, id),
  constraint menu_sections_menu_fk foreign key (store_id, menu_id)
    references public.menus(store_id, id) on delete cascade
);

create table public.products (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null,
  description text,
  image_path text,
  base_price bigint not null check (base_price >= 0),
  is_active boolean not null default true,
  is_sold_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_slug_format check (
    char_length(slug) between 1 and 63
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint products_store_slug_key unique (store_id, slug),
  constraint products_store_id_id_key unique (store_id, id)
);

create table public.menu_items (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  menu_id uuid not null,
  section_id uuid not null,
  product_id uuid not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint menu_items_product_placement_key unique (
    store_id, menu_id, section_id, product_id
  ),
  constraint menu_items_menu_fk foreign key (store_id, menu_id)
    references public.menus(store_id, id) on delete cascade,
  constraint menu_items_section_fk foreign key (store_id, menu_id, section_id)
    references public.menu_sections(store_id, menu_id, id) on delete cascade,
  constraint menu_items_product_fk foreign key (store_id, product_id)
    references public.products(store_id, id) on delete cascade
);

create table public.option_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  selection_type text not null,
  required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_groups_selection_type_check check (
    selection_type in ('single', 'multiple')
  ),
  constraint option_groups_selection_bounds_check check (
    min_select >= 0
    and max_select >= min_select
    and required = (min_select > 0)
    and (selection_type <> 'single' or max_select = 1)
  ),
  constraint option_groups_store_id_id_key unique (store_id, id)
);

create table public.option_values (
  id uuid primary key default extensions.gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  option_group_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  price_adjustment bigint not null default 0 check (price_adjustment >= 0),
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_values_group_fk foreign key (store_id, option_group_id)
    references public.option_groups(store_id, id) on delete cascade
);

create unique index option_values_one_active_default_idx
  on public.option_values (store_id, option_group_id)
  where is_active and is_default;

create table public.product_option_groups (
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null,
  option_group_id uuid not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  primary key (store_id, product_id, option_group_id),
  constraint product_option_groups_product_fk foreign key (store_id, product_id)
    references public.products(store_id, id) on delete cascade,
  constraint product_option_groups_group_fk foreign key (store_id, option_group_id)
    references public.option_groups(store_id, id) on delete cascade
);

create index store_hours_store_order_idx
  on public.store_hours (store_id, day_of_week);
create index menus_store_order_idx
  on public.menus (store_id, is_active, sort_order, id);
create index menu_sections_menu_order_idx
  on public.menu_sections (store_id, menu_id, sort_order, id);
create index products_store_active_order_idx
  on public.products (store_id, is_active, id);
create index menu_items_section_order_idx
  on public.menu_items (store_id, menu_id, section_id, sort_order, id);
create index menu_items_product_idx
  on public.menu_items (store_id, product_id);
create index option_groups_store_order_idx
  on public.option_groups (store_id, is_active, sort_order, id);
create index option_values_group_order_idx
  on public.option_values (store_id, option_group_id, is_active, sort_order, id);
create index product_option_groups_group_idx
  on public.product_option_groups (store_id, option_group_id);

create trigger menus_set_updated_at
before update on public.menus
for each row execute function private.set_updated_at();

create trigger menu_sections_set_updated_at
before update on public.menu_sections
for each row execute function private.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create trigger option_groups_set_updated_at
before update on public.option_groups
for each row execute function private.set_updated_at();

create trigger option_values_set_updated_at
before update on public.option_values
for each row execute function private.set_updated_at();

create or replace function private.validate_store_timezone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names zone
    where zone.name = new.timezone
  ) then
    raise exception 'timezone must be an exact IANA timezone name'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.stores store
    where not exists (
      select 1
      from pg_catalog.pg_timezone_names zone
      where zone.name = store.timezone
    )
  ) then
    raise exception 'existing store has an invalid timezone';
  end if;
end;
$$;

create trigger stores_validate_timezone
before insert or update of timezone on public.stores
for each row execute function private.validate_store_timezone();

alter table public.store_hours enable row level security;
alter table public.menus enable row level security;
alter table public.menu_sections enable row level security;
alter table public.products enable row level security;
alter table public.menu_items enable row level security;
alter table public.option_groups enable row level security;
alter table public.option_values enable row level security;
alter table public.product_option_groups enable row level security;

create policy store_hours_select_member
on public.store_hours for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));
create policy menus_select_member
on public.menus for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));
create policy menu_sections_select_member
on public.menu_sections for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));
create policy products_select_member
on public.products for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));
create policy menu_items_select_member
on public.menu_items for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));
create policy option_groups_select_member
on public.option_groups for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));
create policy option_values_select_member
on public.option_values for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));
create policy product_option_groups_select_member
on public.product_option_groups for select to authenticated
using (private.has_store_role(store_id, array['owner', 'manager', 'staff']));

revoke all on public.store_hours from anon, authenticated;
revoke all on public.menus from anon, authenticated;
revoke all on public.menu_sections from anon, authenticated;
revoke all on public.products from anon, authenticated;
revoke all on public.menu_items from anon, authenticated;
revoke all on public.option_groups from anon, authenticated;
revoke all on public.option_values from anon, authenticated;
revoke all on public.product_option_groups from anon, authenticated;

grant select on public.store_hours to authenticated;
grant select on public.menus to authenticated;
grant select on public.menu_sections to authenticated;
grant select on public.products to authenticated;
grant select on public.menu_items to authenticated;
grant select on public.option_groups to authenticated;
grant select on public.option_values to authenticated;
grant select on public.product_option_groups to authenticated;

create or replace function public.get_storefront_catalog_by_slug(p_public_slug text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with target as (
    select store.id, store.public_slug, store.name, store.description,
      store.logo_path, store.cover_path, store.timezone, store.currency
    from public.stores store
    where store.public_slug = p_public_slug
      and store.is_active
      and store.published_at is not null
    limit 1
  ),
  visible_items as (
    select item.id, item.store_id, item.menu_id, item.section_id,
      item.product_id, item.sort_order
    from public.menu_items item
    join target on target.id = item.store_id
    join public.menus menu
      on menu.store_id = item.store_id and menu.id = item.menu_id and menu.is_active
    join public.menu_sections section
      on section.store_id = item.store_id
      and section.menu_id = item.menu_id
      and section.id = item.section_id
    join public.products product
      on product.store_id = item.store_id
      and product.id = item.product_id
      and product.is_active
  ),
  visible_products as (
    select distinct item.store_id, item.product_id
    from visible_items item
  ),
  visible_links as (
    select link.store_id, link.product_id, link.option_group_id, link.sort_order
    from public.product_option_groups link
    join visible_products product
      on product.store_id = link.store_id and product.product_id = link.product_id
    join public.option_groups option_group
      on option_group.store_id = link.store_id
      and option_group.id = link.option_group_id
      and option_group.is_active
  )
  select jsonb_build_object(
    'store', jsonb_build_object(
      'public_slug', target.public_slug,
      'name', target.name,
      'description', target.description,
      'logo_path', target.logo_path,
      'cover_path', target.cover_path,
      'timezone', target.timezone,
      'currency', target.currency
    ),
    'menus', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', menu.id, 'name', menu.name)
        order by menu.sort_order, menu.id
      )
      from public.menus menu
      where menu.store_id = target.id and menu.is_active
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', section.id,
          'menu_id', section.menu_id,
          'name', section.name,
          'slug', section.slug,
          'description', section.description
        ) order by menu.sort_order, menu.id, section.sort_order, section.id
      )
      from public.menu_sections section
      join public.menus menu
        on menu.store_id = section.store_id
        and menu.id = section.menu_id
        and menu.is_active
      where section.store_id = target.id
    ), '[]'::jsonb),
    'menu_items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'menu_id', item.menu_id,
          'section_id', item.section_id,
          'product_id', item.product_id
        ) order by menu.sort_order, menu.id, section.sort_order, section.id,
          item.sort_order, item.id
      )
      from visible_items item
      join public.menus menu
        on menu.store_id = item.store_id and menu.id = item.menu_id
      join public.menu_sections section
        on section.store_id = item.store_id
        and section.menu_id = item.menu_id
        and section.id = item.section_id
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', product.id,
          'name', product.name,
          'slug', product.slug,
          'description', product.description,
          'base_price', product.base_price::text,
          'image_path', product.image_path
        ) order by product.id
      )
      from public.products product
      join visible_products visible
        on visible.store_id = product.store_id and visible.product_id = product.id
    ), '[]'::jsonb),
    'option_groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', option_group.id,
          'name', option_group.name,
          'selection_type', option_group.selection_type,
          'required', option_group.required,
          'min_select', option_group.min_select,
          'max_select', option_group.max_select,
          'values', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', option_value.id,
                'name', option_value.name,
                'price_adjustment', option_value.price_adjustment::text,
                'is_default', option_value.is_default
              ) order by option_value.sort_order, option_value.id
            )
            from public.option_values option_value
            where option_value.store_id = option_group.store_id
              and option_value.option_group_id = option_group.id
              and option_value.is_active
          ), '[]'::jsonb)
        ) order by option_group.sort_order, option_group.id
      )
      from public.option_groups option_group
      where option_group.store_id = target.id
        and option_group.is_active
        and exists (
          select 1 from visible_links link
          where link.store_id = option_group.store_id
            and link.option_group_id = option_group.id
        )
    ), '[]'::jsonb),
    'product_option_groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', link.product_id,
          'option_group_id', link.option_group_id
        ) order by link.product_id, link.sort_order, link.option_group_id
      )
      from visible_links link
    ), '[]'::jsonb)
  )
  from target;
$$;

create or replace function public.get_storefront_availability_by_slug(p_public_slug text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  with target as (
    select store.id, store.public_slug, store.timezone, store.manual_open_state,
      store.delivery_enabled, store.pickup_enabled
    from public.stores store
    where store.public_slug = p_public_slug
      and store.is_active
      and store.published_at is not null
    limit 1
  )
  select jsonb_build_object(
    'public_slug', target.public_slug,
    'timezone', target.timezone,
    'manual_open_state', target.manual_open_state,
    'delivery_enabled', target.delivery_enabled,
    'pickup_enabled', target.pickup_enabled,
    'hours', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day_of_week', hours.day_of_week,
          'open_time', hours.open_time,
          'close_time', hours.close_time,
          'is_closed', hours.is_closed
        ) order by hours.day_of_week, hours.open_time, hours.id
      )
      from public.store_hours hours
      where hours.store_id = target.id
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', product.id,
          'is_sold_out', product.is_sold_out
        ) order by product.id
      )
      from public.products product
      where product.store_id = target.id and product.is_active
    ), '[]'::jsonb)
  )
  from target;
$$;

revoke all on function private.validate_store_timezone() from public, anon, authenticated;
revoke all on function public.get_storefront_catalog_by_slug(text) from public, anon, authenticated;
revoke all on function public.get_storefront_availability_by_slug(text) from public, anon, authenticated;
grant execute on function public.get_storefront_catalog_by_slug(text) to anon, authenticated;
grant execute on function public.get_storefront_availability_by_slug(text) to anon, authenticated;
