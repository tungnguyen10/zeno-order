begin;

select plan(12);

select has_table('public', 'organizations', 'organizations exists');
select has_table('public', 'organization_members', 'organization_members exists');
select has_table('public', 'stores', 'stores exists');
select has_table('public', 'store_members', 'store_members exists');

insert into public.organizations (id, name, slug)
values ('10000000-0000-0000-0000-000000000001', 'Test Organization', 'test-organization');

insert into public.stores (
  id,
  organization_id,
  public_slug,
  name,
  published_at
)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'test-store',
  'Test Store',
  now()
);

select throws_ok(
  $$insert into public.stores (organization_id, public_slug, name) values ('10000000-0000-0000-0000-000000000001', 'test-store', 'Duplicate')$$,
  '23505',
  null,
  'public slug is globally unique'
);

select throws_ok(
  $$insert into public.stores (organization_id, public_slug, name) values ('10000000-0000-0000-0000-000000000001', 'Uppercase-Slug', 'Invalid')$$,
  '23514',
  null,
  'public slug must be lowercase kebab-case'
);

select throws_ok(
  $$insert into public.stores (organization_id, public_slug, name) values ('10000000-0000-0000-0000-000000000001', 'admin', 'Reserved')$$,
  '23514',
  null,
  'reserved public slugs are rejected'
);

select throws_ok(
  $$update public.stores set public_slug = 'changed-store' where id = '20000000-0000-0000-0000-000000000001'$$,
  'P0001',
  'public_slug cannot change after publication',
  'published public slug is immutable'
);

select throws_ok(
  $$insert into public.stores (organization_id, public_slug, name, currency) values ('10000000-0000-0000-0000-000000000001', 'bad-currency', 'Invalid', 'vnd')$$,
  '23514',
  null,
  'currency must be uppercase ISO-style code'
);

select throws_ok(
  $$insert into public.stores (organization_id, public_slug, name, min_order_amount) values ('10000000-0000-0000-0000-000000000001', 'bad-money', 'Invalid', -1)$$,
  '23514',
  null,
  'money values cannot be negative'
);

select results_eq(
  $$select public_slug, name from public.get_public_store_by_slug('test-store')$$,
  $$values ('test-store'::text, 'Test Store'::text)$$,
  'public resolver returns a published active store'
);

update public.stores set is_active = false where id = '20000000-0000-0000-0000-000000000001';

select is_empty(
  $$select * from public.get_public_store_by_slug('test-store')$$,
  'public resolver hides inactive stores'
);

select * from finish();
rollback;

