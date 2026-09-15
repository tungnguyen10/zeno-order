begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_table('public', 'orders', 'orders exists');
select has_table('public', 'order_items', 'order_items exists');
select has_table('public', 'order_item_options', 'order_item_options exists');
select has_table('public', 'order_status_history', 'order_status_history exists');
select has_table('public', 'order_idempotency', 'order_idempotency exists');
select has_table('public', 'public_rate_limits', 'public_rate_limits exists');

insert into public.organizations (id, name, slug) values
  ('11000000-0000-0000-0000-000000000001', 'R4 A', 'r4-a'),
  ('11000000-0000-0000-0000-000000000002', 'R4 B', 'r4-b');
insert into public.stores (id, organization_id, public_slug, name, published_at) values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'r4-store-a', 'R4 Store A', now()),
  ('21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 'r4-store-b', 'R4 Store B', now());
insert into public.products (id, store_id, name, slug, base_price) values
  ('61000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Coffee', 'coffee', 30000),
  ('61000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'Tea', 'tea', 20000);

insert into public.orders (
  id, store_id, order_number, tracking_token_hash, tracking_key_version,
  fulfillment_type, customer_name, customer_phone, delivery_address,
  subtotal, delivery_fee, discount_amount, total, payment_method,
  idempotency_key
) values (
  'a1000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'A1001', repeat('a', 64), 1, 'delivery', 'Customer', '0900000000',
  'Address', 30000, 5000, 0, 35000, 'cash',
  'e1000000-0000-4000-8000-000000000001'
);
insert into public.order_items (
  id, store_id, order_id, product_id, product_name, unit_price, quantity,
  line_total
) values (
  'a2000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001', 'Coffee', 30000, 1, 30000
);
insert into public.order_item_options (
  store_id, order_item_id, option_group_name, option_name, price_adjustment
) values (
  '21000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001', 'Size', 'Small', 0
);
insert into public.order_status_history (store_id, order_id, from_status, to_status)
values (
  '21000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001', null, 'pending'
);
insert into public.order_idempotency (
  store_id, idempotency_key, request_hash, order_id
) values (
  '21000000-0000-0000-0000-000000000001',
  'e1000000-0000-4000-8000-000000000001', repeat('b', 64),
  'a1000000-0000-0000-0000-000000000001'
);

select throws_ok(
  $$update public.orders set total = -1 where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'order money cannot be negative'
);
select throws_ok(
  $$update public.orders set total = 34000 where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'order total must match components'
);
select throws_ok(
  $$update public.orders set status = 'unknown' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'order status is controlled'
);
select throws_ok(
  $$update public.orders set fulfillment_type = 'pickup', delivery_address = 'Address' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'pickup rejects delivery address'
);
select throws_ok(
  $$update public.orders set tracking_token_hash = 'raw-token' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'tracking field accepts only sha256 hex'
);
select throws_ok(
  $$insert into public.orders (store_id, order_number, tracking_token_hash, tracking_key_version, fulfillment_type, customer_name, customer_phone, subtotal, delivery_fee, discount_amount, total, payment_method, idempotency_key) values ('21000000-0000-0000-0000-000000000001','A1002',repeat('c',64),1,'delivery','C','0900000000',0,0,0,0,'cash','e1000000-0000-4000-8000-000000000002')$$,
  '23514', null, 'delivery requires an address'
);
select throws_ok(
  $$update public.order_items set quantity = 0 where id = 'a2000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'item quantity must be positive'
);
select throws_ok(
  $$update public.order_items set line_total = 1 where id = 'a2000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'item line total must match unit price and quantity'
);
select throws_ok(
  $$update public.order_items set product_id = '61000000-0000-0000-0000-000000000002' where id = 'a2000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'item product cannot cross stores'
);
select throws_ok(
  $$update public.order_items set store_id = '21000000-0000-0000-0000-000000000002' where id = 'a2000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'item order cannot cross stores'
);
select throws_ok(
  $$update public.order_item_options set store_id = '21000000-0000-0000-0000-000000000002' where order_item_id = 'a2000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'option snapshot cannot cross stores'
);
select throws_ok(
  $$update public.order_status_history set store_id = '21000000-0000-0000-0000-000000000002' where order_id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'status history cannot cross stores'
);
select throws_ok(
  $$update public.order_idempotency set request_hash = 'bad' where order_id = 'a1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'request hash accepts only sha256 hex'
);
select throws_ok(
  $$insert into public.order_idempotency (store_id,idempotency_key,request_hash,order_id) values ('21000000-0000-0000-0000-000000000001','e1000000-0000-4000-8000-000000000001',repeat('d',64),'a1000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'idempotency key is unique per store'
);
select throws_ok(
  $$insert into public.public_rate_limits (scope,key_hash,window_started_at,request_count,expires_at) values ('orders',repeat('a',64),date_trunc('minute',now()),0,date_trunc('minute',now()) + interval '1 minute')$$,
  '23514', null, 'rate counter must be positive'
);

select * from finish();
rollback;
