-- Safe demo fixtures. This file contains no Auth users or credentials and may be
-- applied to a linked non-production development project.

insert into public.organizations (id, name, slug, status)
values (
  '10000000-0000-0000-0000-000000000001',
  'Mochi Foods',
  'mochi-foods',
  'active'
)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status;

insert into public.stores (
  id,
  organization_id,
  public_slug,
  name,
  description,
  phone,
  address,
  timezone,
  currency,
  is_active,
  published_at,
  manual_open_state,
  delivery_enabled,
  pickup_enabled
)
values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'mochi-cafe',
  'Mochi Cafe',
  'Cà phê và món ngon được chuẩn bị tươi mỗi ngày.',
  '0900000000',
  'Quận 1, TP. Hồ Chí Minh',
  'Asia/Ho_Chi_Minh',
  'VND',
  true,
  now(),
  'open',
  true,
  true
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  phone = excluded.phone,
  address = excluded.address,
  timezone = excluded.timezone,
  currency = excluded.currency,
  is_active = excluded.is_active,
  published_at = coalesce(public.stores.published_at, excluded.published_at),
  manual_open_state = excluded.manual_open_state,
  delivery_enabled = excluded.delivery_enabled,
  pickup_enabled = excluded.pickup_enabled;

insert into public.menus (id, store_id, name, is_active, sort_order)
values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Thực đơn chính',
  true,
  0
)
on conflict (id) do update set
  name = excluded.name,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

insert into public.menu_sections (
  id, store_id, menu_id, name, slug, description, sort_order
)
values
  (
    '50000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'Cà phê',
    'ca-phe',
    'Cà phê rang xay và pha tươi.',
    0
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'Trà trái cây',
    'tra-trai-cay',
    'Trà thanh mát với trái cây.',
    1
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'Bánh ngọt',
    'banh-ngot',
    'Món ngọt dùng kèm đồ uống.',
    2
  )
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.products (
  id, store_id, name, slug, description, base_price, is_active, is_sold_out
)
values
  (
    '60000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'Cà phê sữa đá',
    'ca-phe-sua-da',
    'Cà phê đậm vị cùng sữa đặc.',
    35000,
    true,
    false
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    'Trà đào cam sả',
    'tra-dao-cam-sa',
    'Trà đào thơm, cam tươi và sả.',
    45000,
    true,
    false
  ),
  (
    '60000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    'Matcha latte',
    'matcha-latte',
    'Matcha Nhật Bản cùng sữa tươi.',
    49000,
    true,
    false
  ),
  (
    '60000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001',
    'Mochi dâu',
    'mochi-dau',
    'Mochi mềm với nhân dâu.',
    29000,
    true,
    true
  )
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  base_price = excluded.base_price,
  is_active = excluded.is_active,
  is_sold_out = excluded.is_sold_out;

insert into public.menu_items (
  id, store_id, menu_id, section_id, product_id, sort_order
)
values
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 0),
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 0),
  ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003', 1),
  ('70000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000004', 0)
on conflict (id) do update set sort_order = excluded.sort_order;

insert into public.option_groups (
  id, store_id, name, selection_type, required, min_select, max_select,
  sort_order, is_active
)
values
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Kích cỡ', 'single', true, 1, 1, 0, true),
  ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Topping', 'multiple', false, 0, 3, 1, true)
on conflict (id) do update set
  name = excluded.name,
  selection_type = excluded.selection_type,
  required = excluded.required,
  min_select = excluded.min_select,
  max_select = excluded.max_select,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.option_values (
  id, store_id, option_group_id, name, price_adjustment, is_default,
  is_active, sort_order
)
values
  ('90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'Nhỏ', 0, true, true, 0),
  ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'Vừa', 7000, false, true, 1),
  ('90000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'Lớn', 12000, false, true, 2),
  ('90000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'Trân châu', 8000, false, true, 0),
  ('90000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'Thạch đào', 9000, false, true, 1)
on conflict (id) do update set
  name = excluded.name,
  price_adjustment = excluded.price_adjustment,
  is_default = excluded.is_default,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

insert into public.product_option_groups (
  store_id, product_id, option_group_id, sort_order
)
values
  ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 0),
  ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 1),
  ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000001', 0),
  ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 1),
  ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000001', 0),
  ('20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000002', 1)
on conflict (store_id, product_id, option_group_id) do update set
  sort_order = excluded.sort_order;

insert into public.store_hours (
  id, store_id, day_of_week, open_time, close_time, is_closed
)
select
  ('b0000000-0000-0000-0000-' || lpad((day_number + 1)::text, 12, '0'))::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  day_number,
  '07:00'::time,
  '22:00'::time,
  false
from generate_series(0, 6) as day_number
on conflict (store_id, day_of_week) do update set
  open_time = excluded.open_time,
  close_time = excluded.close_time,
  is_closed = excluded.is_closed;
