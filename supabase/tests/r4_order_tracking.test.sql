begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.organizations (id,name,slug)
values ('14000000-0000-0000-0000-000000000001','R4 Tracking','r4-tracking');
insert into public.stores (id,organization_id,public_slug,name,published_at)
values ('24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','r4-tracking-store','Tracking Store',now());
insert into public.products (id,store_id,name,slug,base_price)
values ('64000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Coffee','coffee',30000);
insert into public.orders (
  id,store_id,order_number,tracking_token_hash,tracking_key_version,
  fulfillment_type,customer_name,customer_phone,subtotal,delivery_fee,
  discount_amount,total,payment_method,idempotency_key
) values (
  'c4000000-0000-4000-8000-000000000001','24000000-0000-0000-0000-000000000001',
  'A4001',repeat('a',64),1,'pickup','Customer','0900000000',30000,0,0,30000,'cash',
  'd4000000-0000-4000-8000-000000000001'
);
insert into public.order_items (
  id,store_id,order_id,product_id,product_name,unit_price,quantity,line_total
) values (
  'c4100000-0000-4000-8000-000000000001','24000000-0000-0000-0000-000000000001',
  'c4000000-0000-4000-8000-000000000001','64000000-0000-0000-0000-000000000001',
  'Coffee',30000,1,30000
);
insert into public.order_item_options (store_id,order_item_id,option_group_name,option_name,price_adjustment)
values ('24000000-0000-0000-0000-000000000001','c4100000-0000-4000-8000-000000000001','Size','Small',0);

select has_function(
  'public','get_public_order_tracking',array['text','text','text'],
  'limited public order tracking RPC exists'
);
select is(
  public.get_public_order_tracking('r4-tracking-store','A4001',repeat('a',64))->>'orderNumber',
  'A4001','matching token returns the order number'
);
select is(
  public.get_public_order_tracking('r4-tracking-store','A4001',repeat('a',64))->'items'->0->>'name',
  'Coffee','item snapshot is returned'
);
select is(
  public.get_public_order_tracking('r4-tracking-store','A4001',repeat('a',64))->'items'->0->'options'->0->>'name',
  'Small','option snapshot is returned'
);
select is(
  public.get_public_order_tracking('r4-tracking-store','A4001',repeat('a',64))->'totals'->>'total',
  '30000','money remains lossless text'
);
select is(public.get_public_order_tracking('r4-tracking-store','A4001',repeat('b',64)),null,'wrong token is non-enumerating');
select is(public.get_public_order_tracking('r4-tracking-store','A9999',repeat('a',64)),null,'wrong order number is non-enumerating');
select is(public.get_public_order_tracking('missing-store','A4001',repeat('a',64)),null,'wrong tenant slug is non-enumerating');
select ok(
  position('c4000000-0000-4000-8000-000000000001' in public.get_public_order_tracking('r4-tracking-store','A4001',repeat('a',64))::text) = 0,
  'tracking DTO exposes no internal order UUID'
);
select ok(has_function_privilege('anon','public.get_public_order_tracking(text,text,text)','EXECUTE'),'anon may call only the limited tracking RPC');

select * from finish();
rollback;
