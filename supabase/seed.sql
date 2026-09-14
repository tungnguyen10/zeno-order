insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'merchant@local.test',
  crypt('local-only-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.organizations (id, name, slug)
values (
  '10000000-0000-0000-0000-000000000001',
  'Mochi Foods',
  'mochi-foods'
)
on conflict (id) do nothing;

insert into public.stores (
  id,
  organization_id,
  public_slug,
  name,
  description,
  phone,
  address,
  published_at
)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'mochi-cafe',
  'Mochi Cafe',
  'Cà phê và món ngon được chuẩn bị tươi mỗi ngày.',
  '0900000000',
  'Quận 1, TP. Hồ Chí Minh',
  now()
)
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role)
values (
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'owner'
)
on conflict (organization_id, user_id) do nothing;
