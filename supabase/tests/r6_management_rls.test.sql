begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.organizations (id, name, slug) values
  ('16000000-0000-0000-0000-000000000001', 'R6 A', 'r6-a'),
  ('16000000-0000-0000-0000-000000000002', 'R6 B', 'r6-b');

insert into public.stores (id, organization_id, public_slug, name) values
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'r6-store-a', 'R6 A'),
  ('26000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000002', 'r6-store-b', 'R6 B');

insert into auth.users (id) values
  ('36000000-0000-0000-0000-000000000001'),
  ('36000000-0000-0000-0000-000000000002'),
  ('36000000-0000-0000-0000-000000000003'),
  ('36000000-0000-0000-0000-000000000004'),
  ('36000000-0000-0000-0000-000000000005');

insert into public.store_members (store_id, user_id, role) values
  ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000001', 'owner'),
  ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000002', 'manager'),
  ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000003', 'staff'),
  ('26000000-0000-0000-0000-000000000002', '36000000-0000-0000-0000-000000000004', 'owner');

insert into public.store_hours (id, store_id, day_of_week, open_time, close_time) values
  ('46000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 0, '09:00', '17:00'),
  ('46000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', 0, '09:00', '17:00');

insert into public.menus (id, store_id, name) values
  ('56000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'Menu A'),
  ('56000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', 'Menu B');

insert into public.menu_sections (id, store_id, menu_id, name, slug) values
  ('57000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', 'Section A', 'section-a'),
  ('57000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', '56000000-0000-0000-0000-000000000002', 'Section B', 'section-b');

insert into public.products (id, store_id, name, slug, base_price) values
  ('66000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'Coffee A', 'coffee-a', 30000),
  ('66000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', 'Coffee B', 'coffee-b', 30000);

insert into public.menu_items (id, store_id, menu_id, section_id, product_id) values
  ('67000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', '57000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001'),
  ('67000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', '56000000-0000-0000-0000-000000000002', '57000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000002');

insert into public.option_groups (id, store_id, name, selection_type) values
  ('68000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'Options A', 'single'),
  ('68000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', 'Options B', 'single');

insert into public.option_values (id, store_id, option_group_id, name) values
  ('69000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001', 'Value A'),
  ('69000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000002', 'Value B');

insert into public.product_option_groups (store_id, product_id, option_group_id) values
  ('26000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001'),
  ('26000000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000002');

create function pg_temp.r6_visible_stores()
returns table (resource text, store_ids uuid[])
language sql
security invoker
set search_path = ''
as $$
  select resource, array_agg(distinct store_id order by store_id)
  from (
    select 'hours'::text resource, store_id from public.store_hours
    union all select 'memberships', store_id from public.store_members
    union all select 'menu items', store_id from public.menu_items
    union all select 'menus', store_id from public.menus
    union all select 'option assignments', store_id from public.product_option_groups
    union all select 'option groups', store_id from public.option_groups
    union all select 'option values', store_id from public.option_values
    union all select 'products', store_id from public.products
    union all select 'sections', store_id from public.menu_sections
    union all select 'stores', id from public.stores
  ) visible
  group by resource
  order by resource
$$;

-- Store owner: all ten resources are tenant-scoped and manageable.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"36000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$select * from pg_temp.r6_visible_stores()$$,
  $$values
    ('hours', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('memberships', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('menu items', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('menus', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('option assignments', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('option groups', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('option values', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('products', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('sections', array['26000000-0000-0000-0000-000000000001'::uuid]),
    ('stores', array['26000000-0000-0000-0000-000000000001'::uuid])$$,
  'owner sees every resource only in the owned store'
);
select lives_ok($sql$
  do $owner$
  begin
    update public.stores set description = 'Owner updated' where id = '26000000-0000-0000-0000-000000000001';
    update public.store_hours set close_time = '18:00' where id = '46000000-0000-0000-0000-000000000001';
    update public.menus set name = 'Owner menu' where id = '56000000-0000-0000-0000-000000000001';
    update public.menu_sections set name = 'Owner section' where id = '57000000-0000-0000-0000-000000000001';
    update public.products set name = 'Owner coffee' where id = '66000000-0000-0000-0000-000000000001';
    update public.menu_items set sort_order = 1 where id = '67000000-0000-0000-0000-000000000001';
    update public.option_groups set name = 'Owner options' where id = '68000000-0000-0000-0000-000000000001';
    update public.option_values set name = 'Owner value' where id = '69000000-0000-0000-0000-000000000001';
    update public.product_option_groups set sort_order = 1 where store_id = '26000000-0000-0000-0000-000000000001';
    insert into public.store_members (store_id, user_id, role) values ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000005', 'staff');
    update public.store_members set role = 'manager' where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000005';
    delete from public.store_members where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000005';
  end
  $owner$;
$sql$, 'owner manages settings, catalog, hours, and memberships');
select throws_ok(
  $$update public.stores set organization_id = '16000000-0000-0000-0000-000000000002' where id = '26000000-0000-0000-0000-000000000001'$$,
  '23514', 'STORE_ORGANIZATION_IMMUTABLE', 'owner cannot move a store between organizations'
);
reset role;

-- Manager: complete catalog CRUD is allowed, membership mutations are denied.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"36000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$select * from pg_temp.r6_visible_stores()$$,
  $$select resource, array['26000000-0000-0000-0000-000000000001'::uuid] from (values
    ('hours'), ('memberships'), ('menu items'), ('menus'), ('option assignments'),
    ('option groups'), ('option values'), ('products'), ('sections'), ('stores')
  ) expected(resource) order by resource$$,
  'manager sees every resource only in the assigned store'
);
select lives_ok($sql$
  do $manager$
  begin
    update public.stores set phone = 'manager' where id = '26000000-0000-0000-0000-000000000001';
    insert into public.store_hours (id, store_id, day_of_week, open_time, close_time) values ('46000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', 1, '09:00', '17:00');
    update public.store_hours set close_time = '18:00' where id = '46000000-0000-0000-0000-000000000011';
    insert into public.menus (id, store_id, name) values ('56000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', 'Manager menu');
    update public.menus set name = 'Manager menu updated' where id = '56000000-0000-0000-0000-000000000011';
    insert into public.menu_sections (id, store_id, menu_id, name, slug) values ('57000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000011', 'Manager section', 'manager-section');
    update public.menu_sections set name = 'Manager section updated' where id = '57000000-0000-0000-0000-000000000011';
    insert into public.products (id, store_id, name, slug, base_price) values ('66000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', 'Manager product', 'manager-product', 1000);
    update public.products set name = 'Manager product updated' where id = '66000000-0000-0000-0000-000000000011';
    insert into public.menu_items (id, store_id, menu_id, section_id, product_id) values ('67000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000011', '57000000-0000-0000-0000-000000000011', '66000000-0000-0000-0000-000000000011');
    update public.menu_items set sort_order = 2 where id = '67000000-0000-0000-0000-000000000011';
    insert into public.option_groups (id, store_id, name, selection_type) values ('68000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', 'Manager options', 'single');
    update public.option_groups set name = 'Manager options updated' where id = '68000000-0000-0000-0000-000000000011';
    insert into public.option_values (id, store_id, option_group_id, name) values ('69000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000011', 'Manager value');
    update public.option_values set name = 'Manager value updated' where id = '69000000-0000-0000-0000-000000000011';
    insert into public.product_option_groups (store_id, product_id, option_group_id) values ('26000000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-000000000011', '68000000-0000-0000-0000-000000000011');
    update public.product_option_groups set sort_order = 2 where store_id = '26000000-0000-0000-0000-000000000001' and product_id = '66000000-0000-0000-0000-000000000011';
    delete from public.product_option_groups where store_id = '26000000-0000-0000-0000-000000000001' and product_id = '66000000-0000-0000-0000-000000000011';
    delete from public.option_values where id = '69000000-0000-0000-0000-000000000011';
    delete from public.option_groups where id = '68000000-0000-0000-0000-000000000011';
    delete from public.menu_items where id = '67000000-0000-0000-0000-000000000011';
    delete from public.products where id = '66000000-0000-0000-0000-000000000011';
    delete from public.menu_sections where id = '57000000-0000-0000-0000-000000000011';
    delete from public.menus where id = '56000000-0000-0000-0000-000000000011';
    delete from public.store_hours where id = '46000000-0000-0000-0000-000000000011';
  end
  $manager$;
$sql$, 'manager performs catalog and hours CRUD');
select throws_ok(
  $$insert into public.store_members (store_id, user_id, role) values ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000005', 'staff')$$,
  '42501', null, 'manager cannot add memberships'
);
select lives_ok($sql$
  do $manager_members$
  begin
    update public.store_members set role = 'manager' where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000003';
    delete from public.store_members where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000003';
  end
  $manager_members$;
$sql$, 'manager membership update and delete are filtered by RLS');
reset role;
select is((select role from public.store_members where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000003'), 'staff', 'manager cannot change or delete memberships');

-- Staff: all resources are readable; sold-out is the sole permitted mutation.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"36000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$select * from pg_temp.r6_visible_stores()$$,
  $$select resource, array['26000000-0000-0000-0000-000000000001'::uuid] from (values
    ('hours'), ('memberships'), ('menu items'), ('menus'), ('option assignments'),
    ('option groups'), ('option values'), ('products'), ('sections'), ('stores')
  ) expected(resource) order by resource$$,
  'staff sees every resource only in the assigned store'
);
select lives_ok(
  $$update public.products set is_sold_out = true where id = '66000000-0000-0000-0000-000000000001'$$,
  'staff toggles sold-out'
);
select throws_ok(
  $$update public.products set name = 'Changed' where id = '66000000-0000-0000-0000-000000000001'$$,
  '42501', 'PRODUCT_UPDATE_NOT_ALLOWED', 'staff cannot edit product content'
);
select throws_ok(
  $$update public.products set store_id = '26000000-0000-0000-0000-000000000002' where id = '66000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'staff cannot move a product across tenants'
);
select lives_ok($sql$
  do $staff$
  begin
    update public.stores set description = 'Staff changed' where id = '26000000-0000-0000-0000-000000000001';
    update public.store_hours set close_time = '19:00' where id = '46000000-0000-0000-0000-000000000001';
    update public.menus set name = 'Staff changed' where id = '56000000-0000-0000-0000-000000000001';
    update public.menu_sections set name = 'Staff changed' where id = '57000000-0000-0000-0000-000000000001';
    update public.menu_items set sort_order = 9 where id = '67000000-0000-0000-0000-000000000001';
    update public.option_groups set name = 'Staff changed' where id = '68000000-0000-0000-0000-000000000001';
    update public.option_values set name = 'Staff changed' where id = '69000000-0000-0000-0000-000000000001';
    update public.product_option_groups set sort_order = 9 where store_id = '26000000-0000-0000-0000-000000000001';
    update public.store_members set role = 'manager' where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000003';
    delete from public.products where id = '66000000-0000-0000-0000-000000000001';
  end
  $staff$;
$sql$, 'staff writes outside sold-out are filtered by RLS');
select throws_ok(
  $$insert into public.menus (store_id, name) values ('26000000-0000-0000-0000-000000000001', 'Staff menu')$$,
  '42501', null, 'staff cannot create catalog rows'
);
select throws_ok(
  $$insert into public.store_members (store_id, user_id, role) values ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000005', 'staff')$$,
  '42501', null, 'staff cannot add memberships'
);
reset role;

select results_eq(
  $$select resource, value from (values
    ('hours', (select close_time::text from public.store_hours where id = '46000000-0000-0000-0000-000000000001')),
    ('memberships', (select role from public.store_members where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000003')),
    ('menu items', (select sort_order::text from public.menu_items where id = '67000000-0000-0000-0000-000000000001')),
    ('menus', (select name from public.menus where id = '56000000-0000-0000-0000-000000000001')),
    ('option assignments', (select sort_order::text from public.product_option_groups where store_id = '26000000-0000-0000-0000-000000000001')),
    ('option groups', (select name from public.option_groups where id = '68000000-0000-0000-0000-000000000001')),
    ('option values', (select name from public.option_values where id = '69000000-0000-0000-0000-000000000001')),
    ('products', (select name from public.products where id = '66000000-0000-0000-0000-000000000001')),
    ('sections', (select name from public.menu_sections where id = '57000000-0000-0000-0000-000000000001')),
    ('stores', (select description from public.stores where id = '26000000-0000-0000-0000-000000000001'))
  ) state(resource, value) order by resource$$,
  $$values
    ('hours', '18:00:00'), ('memberships', 'staff'), ('menu items', '1'), ('menus', 'Owner menu'),
    ('option assignments', '1'), ('option groups', 'Owner options'), ('option values', 'Owner value'),
    ('products', 'Owner coffee'), ('sections', 'Owner section'), ('stores', 'Owner updated')$$,
  'staff cannot mutate protected resources'
);
select is((select is_sold_out from public.products where id = '66000000-0000-0000-0000-000000000001'), true, 'staff sold-out update persists');

-- A user who owns tenant B cannot read or mutate tenant A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"36000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq(
  $$select * from pg_temp.r6_visible_stores()$$,
  $$select resource, array['26000000-0000-0000-0000-000000000002'::uuid] from (values
    ('hours'), ('memberships'), ('menu items'), ('menus'), ('option assignments'),
    ('option groups'), ('option values'), ('products'), ('sections'), ('stores')
  ) expected(resource) order by resource$$,
  'other-tenant user sees every resource only in tenant B'
);
select lives_ok($$update public.stores set description = 'Tenant B updated' where id = '26000000-0000-0000-0000-000000000002'$$, 'other-tenant owner manages own store');
select lives_ok($sql$
  do $outsider$
  begin
    update public.stores set description = 'Cross tenant' where id = '26000000-0000-0000-0000-000000000001';
    update public.store_hours set close_time = '20:00' where id = '46000000-0000-0000-0000-000000000001';
    update public.menus set name = 'Cross tenant' where id = '56000000-0000-0000-0000-000000000001';
    update public.menu_sections set name = 'Cross tenant' where id = '57000000-0000-0000-0000-000000000001';
    update public.products set name = 'Cross tenant' where id = '66000000-0000-0000-0000-000000000001';
    update public.menu_items set sort_order = 10 where id = '67000000-0000-0000-0000-000000000001';
    update public.option_groups set name = 'Cross tenant' where id = '68000000-0000-0000-0000-000000000001';
    update public.option_values set name = 'Cross tenant' where id = '69000000-0000-0000-0000-000000000001';
    update public.product_option_groups set sort_order = 10 where store_id = '26000000-0000-0000-0000-000000000001';
    update public.store_members set role = 'manager' where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000003';
  end
  $outsider$;
$sql$, 'cross-tenant updates are filtered by RLS for every resource');
select throws_ok(
  $$insert into public.menus (store_id, name) values ('26000000-0000-0000-0000-000000000001', 'Cross tenant')$$,
  '42501', null, 'other-tenant user cannot create cross-tenant catalog rows'
);
select throws_ok(
  $$insert into public.store_members (store_id, user_id, role) values ('26000000-0000-0000-0000-000000000001', '36000000-0000-0000-0000-000000000005', 'staff')$$,
  '42501', null, 'other-tenant user cannot create cross-tenant memberships'
);
reset role;

select is((select description from public.stores where id = '26000000-0000-0000-0000-000000000001'), 'Owner updated', 'cross-tenant store update did not persist');
select is((select close_time from public.store_hours where id = '46000000-0000-0000-0000-000000000001'), '18:00'::time, 'cross-tenant hours update did not persist');
select is((select name from public.menus where id = '56000000-0000-0000-0000-000000000001'), 'Owner menu', 'cross-tenant menu update did not persist');
select is((select name from public.menu_sections where id = '57000000-0000-0000-0000-000000000001'), 'Owner section', 'cross-tenant section update did not persist');
select is((select name from public.products where id = '66000000-0000-0000-0000-000000000001'), 'Owner coffee', 'cross-tenant product update did not persist');
select is((select sort_order from public.menu_items where id = '67000000-0000-0000-0000-000000000001'), 1, 'cross-tenant menu-item update did not persist');
select is((select name from public.option_groups where id = '68000000-0000-0000-0000-000000000001'), 'Owner options', 'cross-tenant option-group update did not persist');
select is((select name from public.option_values where id = '69000000-0000-0000-0000-000000000001'), 'Owner value', 'cross-tenant option-value update did not persist');
select is((select sort_order from public.product_option_groups where store_id = '26000000-0000-0000-0000-000000000001'), 1, 'cross-tenant option-assignment update did not persist');
select is((select role from public.store_members where store_id = '26000000-0000-0000-0000-000000000001' and user_id = '36000000-0000-0000-0000-000000000003'), 'staff', 'cross-tenant membership update did not persist');

-- Public product images accept only the canonical deterministic object name.
select is((select public from storage.buckets where id = 'product-images'), true, 'product image bucket is public');
select is((select file_size_limit from storage.buckets where id = 'product-images'), 2097152::bigint, 'product image size is capped at 2 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'product-images'), array['image/webp']::text[], 'product image bucket accepts only WebP');
select is(private.storage_object_store_id('stores/26000000-0000-0000-0000-000000000001/products/66000000-0000-0000-0000-000000000001/main.webp'), '26000000-0000-0000-0000-000000000001'::uuid, 'canonical Storage path resolves tenant store');
select is(private.storage_object_store_id('stores/not-a-uuid/products/66000000-0000-0000-0000-000000000001/main.webp'), null, 'Storage path rejects invalid store UUID');
select is(private.storage_object_store_id('stores/26000000-0000-0000-0000-000000000001/products/not-a-uuid/main.webp'), null, 'Storage path rejects invalid product UUID');
select is(private.storage_object_store_id('stores/26000000-0000-0000-0000-000000000001/products/66000000-0000-0000-0000-000000000001/alternate.webp'), null, 'Storage path rejects noncanonical filename');
select is(private.storage_object_store_id('stores/26000000-0000-0000-0000-000000000001/products/66000000-0000-0000-0000-000000000001/nested/main.webp'), null, 'Storage path rejects extra segments');
select is(private.storage_object_store_id('bad/path.webp'), null, 'Storage path rejects unrelated prefix');
select ok(has_function_privilege('authenticated', 'private.storage_object_store_id(text)', 'execute'), 'authenticated can execute the Storage helper');
select ok(not has_function_privilege('anon', 'private.storage_object_store_id(text)', 'execute'), 'anon cannot execute the Storage helper');
select ok(not has_function_privilege('authenticated', 'private.guard_product_staff_update()', 'execute'), 'authenticated cannot invoke the product trigger helper');

select results_eq(
  $$select policyname, cmd, qual is not null, with_check is not null
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'product_images_%'
    order by policyname$$,
  $$values
    ('product_images_delete_manager', 'DELETE', true, false),
    ('product_images_insert_manager', 'INSERT', false, true),
    ('product_images_select_member', 'SELECT', true, false),
    ('product_images_update_manager', 'UPDATE', true, true)$$,
  'Storage policies include select, insert, update, and delete with update checks'
);

select * from finish();
rollback;
