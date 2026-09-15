begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.organizations (id,name,slug)
values ('13000000-0000-0000-0000-000000000001','R4 Atomic','r4-atomic');
insert into public.stores (
  id,organization_id,public_slug,name,published_at,manual_open_state,
  delivery_enabled,pickup_enabled,min_order_amount,default_delivery_fee
) values (
  '23000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001','r4-atomic-store','Atomic Store',
  now(),'open',true,true,20000,5000
);
insert into public.products (id,store_id,name,slug,base_price) values
  ('63000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','Coffee','coffee',30000),
  ('63000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000001','Sold','sold',10000);
update public.products set is_sold_out=true where id='63000000-0000-0000-0000-000000000002';
insert into public.option_groups (id,store_id,name,selection_type,required,min_select,max_select) values
  ('83000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','Size','single',true,1,1),
  ('83000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000001','Topping','multiple',false,0,2);
insert into public.option_values (id,store_id,option_group_id,name,price_adjustment,is_default) values
  ('93000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001','Small',0,true),
  ('93000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001','Large',5000,false),
  ('93000000-0000-0000-0000-000000000003','23000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000002','Pearl',8000,false);
insert into public.product_option_groups (store_id,product_id,option_group_id,sort_order) values
  ('23000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000001',0),
  ('23000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000001','83000000-0000-0000-0000-000000000002',1);

select has_function(
  'public','create_order_atomic',
  array['text','uuid','uuid','text','text','integer','text','text','text','text','text','text','text','jsonb'],
  'atomic order function exists'
);
select has_function(
  'public','get_order_request_context',array['text','uuid'],
  'server-only idempotency context exists'
);

select lives_ok($$
  select public.create_order_atomic(
    'r4-atomic-store',
    'c1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    repeat('a',64), repeat('b',64), 1, 'delivery', 'Customer', '0900000000',
    'Address', 'Gate note', 'Order note', 'cash',
    '[{"productId":"63000000-0000-0000-0000-000000000001","quantity":2,"optionValueIds":["93000000-0000-0000-0000-000000000002"],"note":"Less ice"}]'::jsonb
  )
$$,'valid delivery order succeeds');

select is((select subtotal from public.orders where id='c1000000-0000-4000-8000-000000000001'),70000::bigint,'subtotal is recalculated');
select is((select delivery_fee from public.orders where id='c1000000-0000-4000-8000-000000000001'),5000::bigint,'delivery fee is server-owned');
select is((select total from public.orders where id='c1000000-0000-4000-8000-000000000001'),75000::bigint,'total is server-owned');
select is((select unit_price from public.order_items where order_id='c1000000-0000-4000-8000-000000000001'),35000::bigint,'unit price includes selected option');
select is((select option_name from public.order_item_options where order_item_id=(select id from public.order_items where order_id='c1000000-0000-4000-8000-000000000001')),'Large','option name is snapshotted');
select is((select count(*) from public.order_status_history where order_id='c1000000-0000-4000-8000-000000000001' and from_status is null and to_status='pending'),1::bigint,'initial status is recorded');
select is((select request_hash from public.order_idempotency where order_id='c1000000-0000-4000-8000-000000000001'),repeat('a',64),'idempotency hash is stored atomically');

select is(
  public.create_order_atomic(
    'r4-atomic-store','c1000000-0000-4000-8000-000000000099',
    'd1000000-0000-4000-8000-000000000001',repeat('a',64),repeat('c',64),2,
    'delivery','Customer','0900000000','Address','Gate note','Order note','cash',
    '[{"productId":"63000000-0000-0000-0000-000000000001","quantity":2,"optionValueIds":["93000000-0000-0000-0000-000000000002"],"note":"Less ice"}]'::jsonb
  )->>'order_id',
  'c1000000-0000-4000-8000-000000000001',
  'same key and hash returns the existing order'
);
select is((select count(*) from public.orders),1::bigint,'idempotent retry creates no duplicate');

select throws_ok($$
  select public.create_order_atomic(
    'r4-atomic-store','c1000000-0000-4000-8000-000000000098',
    'd1000000-0000-4000-8000-000000000001',repeat('f',64),repeat('d',64),1,
    'pickup','Customer','0900000000',null,null,null,'cash','[]'::jsonb
  )
$$,'P0001','IDEMPOTENCY_CONFLICT','changed payload conflicts');

select throws_ok($$
  select public.create_order_atomic(
    'r4-atomic-store','c1000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000002',repeat('2',64),repeat('3',64),1,
    'pickup','Customer','0900000000',null,null,null,'cash',
    '[{"productId":"63000000-0000-0000-0000-000000000001","quantity":1,"optionValueIds":[],"note":null}]'::jsonb
  )
$$,'P0001','INVALID_OPTIONS','required option is enforced');
select throws_ok($$
  select public.create_order_atomic(
    'r4-atomic-store','c1000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000003',repeat('4',64),repeat('5',64),1,
    'pickup','Customer','0900000000',null,null,null,'cash',
    '[{"productId":"63000000-0000-0000-0000-000000000002","quantity":2,"optionValueIds":[],"note":null}]'::jsonb
  )
$$,'P0001','PRODUCT_UNAVAILABLE','sold-out product is rejected');
select throws_ok($$
  select public.create_order_atomic(
    'r4-atomic-store','c1000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000004',repeat('6',64),repeat('7',64),1,
    'pickup','Customer','0900000000',null,null,null,'cash',
    '[{"productId":"63000000-0000-0000-0000-000000000001","quantity":1,"optionValueIds":["93000000-0000-0000-0000-000000000001","93000000-0000-0000-0000-000000000002"],"note":null}]'::jsonb
  )
$$,'P0001','INVALID_OPTIONS','single group rejects two values');
select is((select count(*) from public.orders),1::bigint,'invalid attempts leave no partial orders');

update public.stores set manual_open_state='closed' where public_slug='r4-atomic-store';
select throws_ok($$
  select public.create_order_atomic(
    'r4-atomic-store','c1000000-0000-4000-8000-000000000005',
    'd1000000-0000-4000-8000-000000000005',repeat('8',64),repeat('9',64),1,
    'pickup','Customer','0900000000',null,null,null,'cash',
    '[{"productId":"63000000-0000-0000-0000-000000000001","quantity":1,"optionValueIds":["93000000-0000-0000-0000-000000000001"],"note":null}]'::jsonb
  )
$$,'P0001','STORE_UNAVAILABLE','closed store is revalidated');

select is(
  public.get_order_request_context('r4-atomic-store','d1000000-0000-4000-8000-000000000001')->>'request_hash',
  repeat('a',64), 'context returns completed hash to server'
);
select ok(not has_function_privilege('anon','public.create_order_atomic(text,uuid,uuid,text,text,integer,text,text,text,text,text,text,text,jsonb)','EXECUTE'),'anon cannot execute atomic writer');
select ok(has_function_privilege('service_role','public.create_order_atomic(text,uuid,uuid,text,text,integer,text,text,text,text,text,text,text,jsonb)','EXECUTE'),'service role can execute atomic writer');

select * from finish();
rollback;
