begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.organizations (id,name,slug) values
  ('15000000-0000-0000-0000-000000000001','R5 Org A','r5-org-a'),
  ('15000000-0000-0000-0000-000000000002','R5 Org B','r5-org-b');
insert into public.stores (id,organization_id,public_slug,name,published_at) values
  ('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','r5-store-a','R5 A',now()),
  ('25000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','r5-store-b','R5 B',now());
insert into auth.users (id) values
  ('35000000-0000-0000-0000-000000000001'),
  ('35000000-0000-0000-0000-000000000002'),
  ('35000000-0000-0000-0000-000000000003');
insert into public.organization_members (organization_id,user_id,role)
values ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','owner');
insert into public.store_members (store_id,user_id,role)
values ('25000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002','staff');

insert into public.orders (
  id,store_id,order_number,tracking_token_hash,tracking_key_version,status,
  fulfillment_type,customer_name,customer_phone,delivery_address,subtotal,delivery_fee,
  discount_amount,total,payment_method,idempotency_key
) values
  ('c5000000-0000-4000-8000-000000000001','25000000-0000-0000-0000-000000000001','A5001',repeat('1',64),1,'pending','pickup','Pickup','0900000001',null,10000,0,0,10000,'cash','d5000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002','25000000-0000-0000-0000-000000000001','A5002',repeat('2',64),1,'pending','delivery','Delivery','0900000002','1 Test Street',10000,0,0,10000,'cash','d5000000-0000-4000-8000-000000000002'),
  ('c5000000-0000-4000-8000-000000000003','25000000-0000-0000-0000-000000000002','A5003',repeat('3',64),1,'pending','pickup','Other','0900000003',null,10000,0,0,10000,'cash','d5000000-0000-4000-8000-000000000003');

select has_function('public','transition_order_status',array['uuid','text','text','text'],'status transition RPC exists');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"35000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select status from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5001','confirmed','Đã nhận')), 'confirmed', 'staff confirms assigned-store order');
select is((select count(*) from public.order_status_history where order_id='c5000000-0000-4000-8000-000000000001' and from_status='pending' and to_status='confirmed' and changed_by='35000000-0000-0000-0000-000000000002' and note='Đã nhận'),1::bigint,'accepted transition writes audit history');
select ok((select confirmed_at is not null from public.orders where order_number='A5001'),'confirmation timestamp is stamped');
select throws_ok($$select * from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5001','ready',null)$$,'23514','INVALID_ORDER_STATUS_TRANSITION','staff cannot skip transition states');
select is((select status from public.orders where order_number='A5001'),'confirmed','rejected transition leaves state unchanged');
select is((select status from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5001','preparing',null)), 'preparing', 'confirmed moves to preparing');
select is((select status from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5001','ready',null)), 'ready', 'preparing moves to ready');
select throws_ok($$select * from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5001','delivering',null)$$,'23514','INVALID_ORDER_STATUS_TRANSITION','pickup order cannot start delivery');
select is((select status from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5001','completed',null)), 'completed', 'ready pickup order completes');
select ok((select completed_at is not null from public.orders where order_number='A5001'),'completion timestamp is stamped');
select throws_ok($$select * from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5001','cancelled',null)$$,'23514','INVALID_ORDER_STATUS_TRANSITION','terminal order cannot transition');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"35000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((select status from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5002','cancelled','Hết món')), 'cancelled', 'organization owner inherits store operation access');
select ok((select cancelled_at is not null from public.orders where order_number='A5002'),'cancellation timestamp is stamped');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"35000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select * from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5002','confirmed',null)$$,'P0002','ORDER_NOT_FOUND','outsider receives a non-enumerating miss');
select throws_ok($$update public.orders set status='confirmed' where store_id='25000000-0000-0000-0000-000000000002'$$,'42501',null,'outsider cannot update cross-tenant order');
reset role;

set local role anon;
select throws_ok($$select * from public.transition_order_status('25000000-0000-0000-0000-000000000001','A5002','confirmed',null)$$,'42501',null,'anon cannot execute merchant transition RPC');
reset role;

select * from finish();
rollback;
