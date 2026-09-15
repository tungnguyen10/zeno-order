create or replace function private.enforce_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transition_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  if not private.has_store_role(new.store_id, array['owner', 'manager', 'staff']) then
    raise insufficient_privilege using message = 'ORDER_ACCESS_DENIED';
  end if;

  transition_allowed := case old.status
    when 'pending' then new.status in ('confirmed', 'cancelled')
    when 'confirmed' then new.status in ('preparing', 'cancelled')
    when 'preparing' then new.status in ('ready', 'cancelled')
    when 'ready' then new.status in (
      case when old.fulfillment_type = 'delivery' then 'delivering' else 'completed' end,
      'cancelled'
    )
    when 'delivering' then new.status in ('completed', 'cancelled')
    else false
  end;

  if not transition_allowed then
    raise check_violation using message = 'INVALID_ORDER_STATUS_TRANSITION';
  end if;

  if new.status = 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now()); end if;
  if new.status = 'ready' then new.ready_at := coalesce(new.ready_at, now()); end if;
  if new.status = 'completed' then new.completed_at := coalesce(new.completed_at, now()); end if;
  if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
  return new;
end;
$$;

create or replace function private.audit_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (
      store_id, order_id, from_status, to_status, changed_by, note
    ) values (
      new.store_id,
      new.id,
      old.status,
      new.status,
      auth.uid(),
      nullif(current_setting('request.transition_note', true), '')
    );
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_order_status_transition() from public;
revoke all on function private.audit_order_status_transition() from public;

create trigger orders_enforce_status_transition
before update of status on public.orders
for each row execute function private.enforce_order_status_transition();

create trigger orders_audit_status_transition
after update of status on public.orders
for each row execute function private.audit_order_status_transition();

create policy orders_update_store_operator
on public.orders for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])));

grant update (status) on public.orders to authenticated;

create or replace function public.transition_order_status(
  p_store_id uuid,
  p_order_number text,
  p_to_status text,
  p_note text default null
)
returns table (order_number text, status text, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id uuid;
  current_status text;
begin
  if p_note is not null and char_length(p_note) > 500 then
    raise check_violation using message = 'ORDER_STATUS_NOTE_TOO_LONG';
  end if;

  select orders.id, orders.status
  into target_id, current_status
  from public.orders
  where orders.store_id = p_store_id
    and orders.order_number = p_order_number
  for update;

  if target_id is null then
    raise no_data_found using message = 'ORDER_NOT_FOUND';
  end if;

  if current_status = p_to_status then
    return query
    select orders.order_number, orders.status, orders.updated_at
    from public.orders
    where orders.id = target_id;
    return;
  end if;

  perform set_config('request.transition_note', coalesce(p_note, ''), true);

  return query
  update public.orders
  set status = p_to_status
  where orders.id = target_id
  returning orders.order_number, orders.status, orders.updated_at;
end;
$$;

revoke all on function public.transition_order_status(uuid, text, text, text) from public, anon;
grant execute on function public.transition_order_status(uuid, text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
