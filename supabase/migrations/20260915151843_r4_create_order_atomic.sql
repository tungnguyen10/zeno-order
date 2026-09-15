create or replace function public.get_order_request_context(
  p_public_slug text,
  p_idempotency_key uuid
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'store_id', store.id,
    'request_hash', request.request_hash,
    'order_id', request.order_id,
    'order_number', placed.order_number,
    'tracking_key_version', placed.tracking_key_version
  )
  from public.stores store
  left join public.order_idempotency request
    on request.store_id = store.id
   and request.idempotency_key = p_idempotency_key
  left join public.orders placed
    on placed.store_id = request.store_id
   and placed.id = request.order_id
  where store.public_slug = p_public_slug
    and store.is_active
    and store.published_at is not null
  limit 1;
$$;

create or replace function public.create_order_atomic(
  p_public_slug text,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_tracking_token_hash text,
  p_tracking_key_version integer,
  p_fulfillment_type text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_delivery_note text,
  p_customer_note text,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  target_store public.stores%rowtype;
  existing_request record;
  item jsonb;
  product_row public.products%rowtype;
  group_row record;
  item_id uuid;
  product_id uuid;
  option_ids jsonb;
  quantity integer;
  selected_count integer;
  distinct_count integer;
  unit_price bigint;
  subtotal_amount bigint := 0;
  delivery_fee_amount bigint := 0;
  order_number_value text;
  store_is_open boolean := false;
  local_timestamp timestamp;
begin
  select store.* into target_store
  from public.stores store
  where store.public_slug = p_public_slug
    and store.is_active
    and store.published_at is not null
  limit 1;

  if not found then
    raise exception 'STORE_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_store.id::text || ':' || p_idempotency_key::text, 0)
  );

  select request.request_hash, request.order_id, placed.order_number,
    placed.tracking_key_version, placed.subtotal, placed.delivery_fee,
    placed.discount_amount, placed.total
  into existing_request
  from public.order_idempotency request
  join public.orders placed
    on placed.store_id = request.store_id and placed.id = request.order_id
  where request.store_id = target_store.id
    and request.idempotency_key = p_idempotency_key;

  if found then
    if existing_request.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    return jsonb_build_object(
      'store_id', target_store.id,
      'order_id', existing_request.order_id,
      'order_number', existing_request.order_number,
      'tracking_key_version', existing_request.tracking_key_version,
      'subtotal', existing_request.subtotal::text,
      'delivery_fee', existing_request.delivery_fee::text,
      'discount_amount', existing_request.discount_amount::text,
      'total', existing_request.total::text,
      'created', false
    );
  end if;

  if p_order_id is null
    or p_idempotency_key is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_tracking_token_hash !~ '^[0-9a-f]{64}$'
    or p_tracking_key_version < 1
    or p_fulfillment_type not in ('delivery', 'pickup')
    or p_payment_method not in ('cash', 'bank_transfer')
    or char_length(btrim(p_customer_name)) not between 1 and 120
    or char_length(btrim(p_customer_phone)) not between 5 and 32
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 50
  then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  if p_fulfillment_type = 'delivery' then
    if not target_store.delivery_enabled
      or p_delivery_address is null
      or char_length(btrim(p_delivery_address)) not between 1 and 500
    then
      raise exception 'FULFILLMENT_UNAVAILABLE' using errcode = 'P0001';
    end if;
  elsif not target_store.pickup_enabled
    or p_delivery_address is not null
    or p_delivery_note is not null
  then
    raise exception 'FULFILLMENT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if (p_delivery_note is not null and char_length(p_delivery_note) > 500)
    or (p_customer_note is not null and char_length(p_customer_note) > 500)
  then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  if target_store.manual_open_state = 'open' then
    store_is_open := true;
  elsif target_store.manual_open_state in ('closed', 'temporarily_closed') then
    store_is_open := false;
  else
    local_timestamp := pg_catalog.timezone(target_store.timezone, statement_timestamp());
    select exists (
      select 1
      from public.store_hours hours
      where hours.store_id = target_store.id
        and hours.day_of_week = extract(dow from local_timestamp)::integer
        and not hours.is_closed
        and local_timestamp::time >= hours.open_time
        and local_timestamp::time < hours.close_time
    ) into store_is_open;
  end if;

  if not store_is_open then
    raise exception 'STORE_UNAVAILABLE' using errcode = 'P0001';
  end if;

  -- Lock selected catalog rows in deterministic order so prices and option rules
  -- cannot change between validation and snapshot insertion.
  perform 1
  from public.products product
  where product.store_id = target_store.id
    and product.id in (
      select (entry->>'productId')::uuid from jsonb_array_elements(p_items) entry
    )
  order by product.id
  for share;

  perform 1
  from public.option_values value
  where value.store_id = target_store.id
    and value.id in (
      select selected.value_id::uuid
      from jsonb_array_elements(p_items) entry
      cross join lateral jsonb_array_elements_text(coalesce(entry->'optionValueIds', '[]'::jsonb)) selected(value_id)
    )
  order by value.id
  for share;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'productId')
      or not (item ? 'quantity')
    then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;

    product_id := (item->>'productId')::uuid;
    quantity := (item->>'quantity')::integer;
    option_ids := coalesce(item->'optionValueIds', '[]'::jsonb);

    if quantity not between 1 and 99
      or jsonb_typeof(option_ids) <> 'array'
      or (item->>'note' is not null and char_length(item->>'note') > 500)
    then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;

    select product.* into product_row
    from public.products product
    where product.store_id = target_store.id
      and product.id = product_id
      and product.is_active
      and not product.is_sold_out;

    if not found then
      raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001';
    end if;

    select count(*), count(distinct selected.value_id)
    into selected_count, distinct_count
    from jsonb_array_elements_text(option_ids) selected(value_id);

    if selected_count <> distinct_count then
      raise exception 'INVALID_OPTIONS' using errcode = 'P0001';
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(option_ids) selected(value_id)
      where not exists (
        select 1
        from public.option_values value
        join public.option_groups option_group
          on option_group.store_id = value.store_id
         and option_group.id = value.option_group_id
         and option_group.is_active
        join public.product_option_groups link
          on link.store_id = value.store_id
         and link.option_group_id = value.option_group_id
         and link.product_id = product_id
        where value.store_id = target_store.id
          and value.id = selected.value_id::uuid
          and value.is_active
      )
    ) then
      raise exception 'INVALID_OPTIONS' using errcode = 'P0001';
    end if;

    for group_row in
      select option_group.id, option_group.selection_type,
        option_group.min_select, option_group.max_select,
        count(value.id) filter (
          where value.id::text in (
            select selected.value_id from jsonb_array_elements_text(option_ids) selected(value_id)
          )
        )::integer as selection_count
      from public.product_option_groups link
      join public.option_groups option_group
        on option_group.store_id = link.store_id
       and option_group.id = link.option_group_id
       and option_group.is_active
      left join public.option_values value
        on value.store_id = option_group.store_id
       and value.option_group_id = option_group.id
       and value.is_active
      where link.store_id = target_store.id
        and link.product_id = product_id
      group by option_group.id, option_group.selection_type,
        option_group.min_select, option_group.max_select
    loop
      if group_row.selection_count < group_row.min_select
        or group_row.selection_count > group_row.max_select
        or (group_row.selection_type = 'single' and group_row.selection_count > 1)
      then
        raise exception 'INVALID_OPTIONS' using errcode = 'P0001';
      end if;
    end loop;

    select product_row.base_price + coalesce(sum(value.price_adjustment), 0)
    into unit_price
    from jsonb_array_elements_text(option_ids) selected(value_id)
    join public.option_values value
      on value.store_id = target_store.id
     and value.id = selected.value_id::uuid;

    subtotal_amount := subtotal_amount + (unit_price * quantity);
  end loop;

  if subtotal_amount < target_store.min_order_amount then
    raise exception 'MINIMUM_ORDER_NOT_MET' using errcode = 'P0001';
  end if;

  if p_fulfillment_type = 'delivery' then
    delivery_fee_amount := target_store.default_delivery_fee;
  end if;

  order_number_value := 'A' || nextval('public.order_display_number_seq')::text;

  insert into public.orders (
    id, store_id, order_number, tracking_token_hash, tracking_key_version,
    fulfillment_type, customer_name, customer_phone, delivery_address,
    delivery_note, customer_note, subtotal, delivery_fee, discount_amount,
    total, payment_method, idempotency_key
  ) values (
    p_order_id, target_store.id, order_number_value, p_tracking_token_hash,
    p_tracking_key_version::smallint, p_fulfillment_type, btrim(p_customer_name),
    btrim(p_customer_phone), nullif(btrim(p_delivery_address), ''),
    nullif(btrim(p_delivery_note), ''), nullif(btrim(p_customer_note), ''),
    subtotal_amount, delivery_fee_amount, 0,
    subtotal_amount + delivery_fee_amount, p_payment_method, p_idempotency_key
  );

  for item in select value from jsonb_array_elements(p_items)
  loop
    product_id := (item->>'productId')::uuid;
    quantity := (item->>'quantity')::integer;
    option_ids := coalesce(item->'optionValueIds', '[]'::jsonb);

    select product.* into product_row
    from public.products product
    where product.store_id = target_store.id and product.id = product_id;

    select product_row.base_price + coalesce(sum(value.price_adjustment), 0)
    into unit_price
    from jsonb_array_elements_text(option_ids) selected(value_id)
    join public.option_values value
      on value.store_id = target_store.id and value.id = selected.value_id::uuid;

    item_id := extensions.gen_random_uuid();
    insert into public.order_items (
      id, store_id, order_id, product_id, product_name, unit_price, quantity,
      line_total, note
    ) values (
      item_id, target_store.id, p_order_id, product_row.id, product_row.name,
      unit_price, quantity, unit_price * quantity, nullif(btrim(item->>'note'), '')
    );

    insert into public.order_item_options (
      store_id, order_item_id, option_group_name, option_name, price_adjustment
    )
    select target_store.id, item_id, option_group.name, value.name,
      value.price_adjustment
    from jsonb_array_elements_text(option_ids) selected(value_id)
    join public.option_values value
      on value.store_id = target_store.id and value.id = selected.value_id::uuid
    join public.option_groups option_group
      on option_group.store_id = value.store_id and option_group.id = value.option_group_id;
  end loop;

  insert into public.order_status_history (store_id, order_id, from_status, to_status)
  values (target_store.id, p_order_id, null, 'pending');

  insert into public.order_idempotency (store_id, idempotency_key, request_hash, order_id)
  values (target_store.id, p_idempotency_key, p_request_hash, p_order_id);

  return jsonb_build_object(
    'store_id', target_store.id,
    'order_id', p_order_id,
    'order_number', order_number_value,
    'tracking_key_version', p_tracking_key_version,
    'subtotal', subtotal_amount::text,
    'delivery_fee', delivery_fee_amount::text,
    'discount_amount', '0',
    'total', (subtotal_amount + delivery_fee_amount)::text,
    'created', true
  );
end;
$$;

revoke all on function public.get_order_request_context(text, uuid)
  from public, anon, authenticated;
revoke all on function public.create_order_atomic(
  text, uuid, uuid, text, text, integer, text, text, text, text, text, text,
  text, jsonb
) from public, anon, authenticated;

grant execute on function public.get_order_request_context(text, uuid) to service_role;
grant execute on function public.create_order_atomic(
  text, uuid, uuid, text, text, integer, text, text, text, text, text, text,
  text, jsonb
) to service_role;
