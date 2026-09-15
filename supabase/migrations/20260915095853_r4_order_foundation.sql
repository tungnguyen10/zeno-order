create sequence public.order_display_number_seq as bigint start with 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  order_number text not null,
  tracking_token_hash text not null,
  tracking_key_version smallint not null,
  status text not null default 'pending',
  fulfillment_type text not null,
  customer_name text not null,
  customer_phone text not null,
  delivery_address text,
  delivery_note text,
  customer_note text,
  subtotal bigint not null,
  delivery_fee bigint not null default 0,
  discount_amount bigint not null default 0,
  total bigint not null,
  payment_method text not null,
  payment_status text not null default 'unpaid',
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint orders_store_id_id_key unique (store_id, id),
  constraint orders_store_id_order_number_key unique (store_id, order_number),
  constraint orders_store_id_idempotency_key unique (store_id, idempotency_key),
  constraint orders_store_id_id_idempotency_key unique (store_id, id, idempotency_key),
  constraint orders_tracking_token_hash_key unique (tracking_token_hash),
  constraint orders_order_number_format check (order_number ~ '^[A-Z][A-Z0-9-]{3,31}$'),
  constraint orders_tracking_token_hash_format check (tracking_token_hash ~ '^[0-9a-f]{64}$'),
  constraint orders_tracking_key_version_positive check (tracking_key_version > 0),
  constraint orders_status_controlled check (
    status in ('pending', 'confirmed', 'preparing', 'ready', 'delivering', 'completed', 'cancelled')
  ),
  constraint orders_fulfillment_type_controlled check (fulfillment_type in ('delivery', 'pickup')),
  constraint orders_customer_name_length check (char_length(btrim(customer_name)) between 1 and 120),
  constraint orders_customer_phone_length check (char_length(btrim(customer_phone)) between 5 and 32),
  constraint orders_delivery_address_length check (
    delivery_address is null or char_length(btrim(delivery_address)) between 1 and 500
  ),
  constraint orders_delivery_note_length check (delivery_note is null or char_length(delivery_note) <= 500),
  constraint orders_customer_note_length check (customer_note is null or char_length(customer_note) <= 500),
  constraint orders_delivery_shape check (
    (fulfillment_type = 'delivery' and delivery_address is not null)
    or (fulfillment_type = 'pickup' and delivery_address is null and delivery_note is null)
  ),
  constraint orders_money_non_negative check (
    subtotal >= 0 and delivery_fee >= 0 and discount_amount >= 0 and total >= 0
  ),
  constraint orders_discount_bounded check (discount_amount <= subtotal + delivery_fee),
  constraint orders_total_arithmetic check (total = subtotal + delivery_fee - discount_amount),
  constraint orders_payment_method_controlled check (payment_method in ('cash', 'bank_transfer')),
  constraint orders_payment_status_controlled check (
    payment_status in ('unpaid', 'pending', 'paid', 'failed', 'refunded')
  )
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  product_id uuid,
  product_name text not null,
  unit_price bigint not null,
  quantity integer not null,
  line_total bigint not null,
  note text,
  created_at timestamptz not null default now(),
  constraint order_items_store_id_id_key unique (store_id, id),
  constraint order_items_order_fkey foreign key (store_id, order_id)
    references public.orders(store_id, id) on delete cascade,
  constraint order_items_product_fkey foreign key (store_id, product_id)
    references public.products(store_id, id) on delete restrict,
  constraint order_items_product_name_length check (char_length(btrim(product_name)) between 1 and 120),
  constraint order_items_quantity_range check (quantity between 1 and 99),
  constraint order_items_money_non_negative check (unit_price >= 0 and line_total >= 0),
  constraint order_items_line_total_arithmetic check (line_total = unit_price * quantity),
  constraint order_items_note_length check (note is null or char_length(note) <= 500)
);

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_item_id uuid not null,
  option_group_name text not null,
  option_name text not null,
  price_adjustment bigint not null,
  created_at timestamptz not null default now(),
  constraint order_item_options_item_fkey foreign key (store_id, order_item_id)
    references public.order_items(store_id, id) on delete cascade,
  constraint order_item_options_group_name_length check (
    char_length(btrim(option_group_name)) between 1 and 120
  ),
  constraint order_item_options_name_length check (char_length(btrim(option_name)) between 1 and 120),
  constraint order_item_options_price_non_negative check (price_adjustment >= 0)
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint order_status_history_order_fkey foreign key (store_id, order_id)
    references public.orders(store_id, id) on delete cascade,
  constraint order_status_history_from_status_controlled check (
    from_status is null or from_status in ('pending', 'confirmed', 'preparing', 'ready', 'delivering', 'completed', 'cancelled')
  ),
  constraint order_status_history_to_status_controlled check (
    to_status in ('pending', 'confirmed', 'preparing', 'ready', 'delivering', 'completed', 'cancelled')
  ),
  constraint order_status_history_note_length check (note is null or char_length(note) <= 500)
);

create table public.order_idempotency (
  store_id uuid not null,
  idempotency_key uuid not null,
  request_hash text not null,
  order_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (store_id, idempotency_key),
  constraint order_idempotency_order_key unique (store_id, order_id),
  constraint order_idempotency_request_hash_format check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint order_idempotency_order_fkey foreign key (store_id, order_id, idempotency_key)
    references public.orders(store_id, id, idempotency_key) on delete restrict
);

create table public.public_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_started_at),
  constraint public_rate_limits_scope_length check (char_length(scope) between 1 and 100),
  constraint public_rate_limits_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint public_rate_limits_count_positive check (request_count > 0),
  constraint public_rate_limits_window_valid check (expires_at > window_started_at)
);

create index orders_store_created_at_idx on public.orders (store_id, created_at desc);
create index orders_store_status_created_at_idx on public.orders (store_id, status, created_at desc);
create index order_items_store_order_idx on public.order_items (store_id, order_id);
create index order_items_store_product_idx on public.order_items (store_id, product_id);
create index order_item_options_store_item_idx on public.order_item_options (store_id, order_item_id);
create index order_status_history_store_order_created_idx
  on public.order_status_history (store_id, order_id, created_at);
create index order_status_history_changed_by_idx on public.order_status_history (changed_by);
create index public_rate_limits_expires_at_idx on public.public_rate_limits (expires_at);

create trigger orders_set_updated_at
before update on public.orders
for each row execute function private.set_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_idempotency enable row level security;
alter table public.public_rate_limits enable row level security;

create policy orders_select_store_member
on public.orders for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])));

create policy order_items_select_store_member
on public.order_items for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])));

create policy order_item_options_select_store_member
on public.order_item_options for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])));

create policy order_status_history_select_store_member
on public.order_status_history for select to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])));

revoke all on public.orders, public.order_items, public.order_item_options,
  public.order_status_history, public.order_idempotency, public.public_rate_limits
  from anon, authenticated;
revoke all on sequence public.order_display_number_seq from public, anon, authenticated;

grant select on public.orders, public.order_items, public.order_item_options,
  public.order_status_history to authenticated;
