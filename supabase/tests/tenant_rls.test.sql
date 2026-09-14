begin;

select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', crypt('local-password', gen_salt('bf')), now(), '{}', '{}', now(), now()),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@example.test', crypt('local-password', gen_salt('bf')), now(), '{}', '{}', now(), now()),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', crypt('local-password', gen_salt('bf')), now(), '{}', '{}', now(), now());

insert into public.organizations (id, name, slug)
values
  ('10000000-0000-0000-0000-000000000001', 'Organization A', 'organization-a'),
  ('10000000-0000-0000-0000-000000000002', 'Organization B', 'organization-b');

insert into public.stores (id, organization_id, public_slug, name)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'organization-a-store', 'Organization A Store'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'organization-b-store', 'Organization B Store');

insert into public.organization_members (organization_id, user_id, role)
values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'owner');

insert into public.store_members (store_id, user_id, role)
values ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'staff');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$select public_slug from public.stores order by public_slug$$,
  $$values ('organization-a-store'::text)$$,
  'organization owner inherits access to every store in the organization'
);

select results_eq(
  $$select slug from public.organizations order by slug$$,
  $$values ('organization-a'::text)$$,
  'organization owner cannot read another organization'
);

select lives_ok(
  $$select * from public.store_members where store_id = '20000000-0000-0000-0000-000000000001'$$,
  'organization owner can query memberships in an inherited store'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$select public_slug from public.stores order by public_slug$$,
  $$values ('organization-b-store'::text)$$,
  'store staff sees only the assigned store'
);

select is_empty(
  $$select * from public.organizations$$,
  'store staff does not inherit organization access'
);

select throws_ok(
  $$update public.stores set name = 'Not allowed' where id = '20000000-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'merchant mutation is denied until a write policy is introduced'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select is_empty($$select * from public.stores$$, 'unassigned authenticated user sees no stores');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.stores$$,
  '42501',
  null,
  'anon cannot select business tables directly'
);

reset role;
select * from finish();
rollback;

