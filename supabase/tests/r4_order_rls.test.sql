begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.organizations (id, name, slug) values
  ('12000000-0000-0000-0000-000000000001', 'R4 RLS A', 'r4-rls-a'),
  ('12000000-0000-0000-0000-000000000002', 'R4 RLS B', 'r4-rls-b');
insert into public.stores (id, organization_id, public_slug, name, published_at) values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'r4-rls-store-a', 'R4 A', now()),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', 'r4-rls-store-b', 'R4 B', now());
insert into auth.users (id) values
  ('32000000-0000-0000-0000-000000000001'),
  ('32000000-0000-0000-0000-000000000002');
insert into public.store_members (store_id, user_id, role)
values ('22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 'staff');

insert into public.orders (
  id, store_id, order_number, tracking_token_hash, tracking_key_version,
  fulfillment_type, customer_name, customer_phone, subtotal, delivery_fee,
  discount_amount, total, payment_method, idempotency_key
) values
  ('b1000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','B1001',repeat('1',64),1,'pickup','A','0900000000',10000,0,0,10000,'cash','f1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002','B1002',repeat('2',64),1,'pickup','B','0900000001',20000,0,0,20000,'cash','f1000000-0000-4000-8000-000000000002');
insert into public.order_items (id,store_id,order_id,product_name,unit_price,quantity,line_total) values
  ('b2000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','A',10000,1,10000),
  ('b2000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002','B',20000,1,20000);
insert into public.order_item_options (store_id,order_item_id,option_group_name,option_name,price_adjustment) values
  ('22000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','Size','S',0),
  ('22000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000002','Size','S',0);
insert into public.order_status_history (store_id,order_id,to_status) values
  ('22000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','pending'),
  ('22000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002','pending');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"32000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select results_eq($$select order_number from public.orders order by order_number$$,$$values ('B1001'::text)$$,'staff reads only assigned-store orders');
select results_eq($$select product_name from public.order_items$$,$$values ('A'::text)$$,'staff reads only assigned-store items');
select results_eq($$select option_name from public.order_item_options$$,$$values ('S'::text)$$,'staff reads only assigned-store option snapshots');
select is((select count(*) from public.order_status_history),1::bigint,'staff reads only assigned-store history');
select throws_ok($$insert into public.orders (store_id) values ('22000000-0000-0000-0000-000000000001')$$,'42501',null,'authenticated cannot insert orders directly');
select throws_ok($$update public.orders set status='confirmed'$$,'42501',null,'authenticated cannot update orders directly');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"32000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is_empty($$select * from public.orders$$,'outsider sees no orders');
select is_empty($$select * from public.order_items$$,'outsider sees no items');
reset role;

set local role anon;
select throws_ok($$select * from public.orders$$,'42501',null,'anon cannot select orders directly');
select throws_ok($$select * from public.order_items$$,'42501',null,'anon cannot select order items directly');
select throws_ok($$select * from public.order_item_options$$,'42501',null,'anon cannot select options directly');
select throws_ok($$select * from public.order_status_history$$,'42501',null,'anon cannot select history directly');
select throws_ok($$select * from public.order_idempotency$$,'42501',null,'anon cannot select idempotency data');
select throws_ok($$select * from public.public_rate_limits$$,'42501',null,'anon cannot select rate limits');
select throws_ok($$insert into public.orders (store_id) values ('22000000-0000-0000-0000-000000000001')$$,'42501',null,'anon cannot insert orders');
reset role;

select * from finish();
rollback;
