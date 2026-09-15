create or replace function public.get_public_order_tracking(
  p_public_slug text,
  p_order_number text,
  p_tracking_token_hash text
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'orderNumber', placed.order_number,
    'status', placed.status,
    'fulfillmentType', placed.fulfillment_type,
    'paymentMethod', placed.payment_method,
    'paymentStatus', placed.payment_status,
    'customerNote', placed.customer_note,
    'items', coalesce((
      select jsonb_agg(item_row.payload order by item_row.created_at, item_row.id)
      from (
        select item.id, item.created_at, jsonb_build_object(
          'name', item.product_name,
          'unitPrice', item.unit_price::text,
          'quantity', item.quantity,
          'lineTotal', item.line_total::text,
          'note', item.note,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'groupName', option_snapshot.option_group_name,
                'name', option_snapshot.option_name,
                'priceAdjustment', option_snapshot.price_adjustment::text
              ) order by option_snapshot.created_at, option_snapshot.id
            )
            from public.order_item_options option_snapshot
            where option_snapshot.store_id = item.store_id
              and option_snapshot.order_item_id = item.id
          ), '[]'::jsonb)
        ) as payload
        from public.order_items item
        where item.store_id = placed.store_id
          and item.order_id = placed.id
      ) item_row
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subtotal', placed.subtotal::text,
      'deliveryFee', placed.delivery_fee::text,
      'discountAmount', placed.discount_amount::text,
      'total', placed.total::text,
      'currency', store.currency
    ),
    'createdAt', placed.created_at,
    'updatedAt', placed.updated_at
  )
  from public.orders placed
  join public.stores store on store.id = placed.store_id
  where p_tracking_token_hash ~ '^[0-9a-f]{64}$'
    and store.public_slug = p_public_slug
    and placed.order_number = p_order_number
    and placed.tracking_token_hash = p_tracking_token_hash
  limit 1;
$$;

revoke all on function public.get_public_order_tracking(text, text, text)
  from public;
grant execute on function public.get_public_order_tracking(text, text, text)
  to anon, authenticated;
