create or replace function private.guard_product_staff_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if private.has_store_role(old.store_id, array['owner', 'manager']) then
    return new;
  end if;
  if private.has_store_role(old.store_id, array['staff'])
    and (to_jsonb(new) - array['is_sold_out', 'updated_at']) = (to_jsonb(old) - array['is_sold_out', 'updated_at'])
  then
    return new;
  end if;
  raise insufficient_privilege using message = 'PRODUCT_UPDATE_NOT_ALLOWED';
end;
$$;

create or replace function private.prevent_store_organization_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise check_violation using message = 'STORE_ORGANIZATION_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_product_staff_update() from public, anon, authenticated;
revoke all on function private.prevent_store_organization_change() from public, anon, authenticated;

create trigger products_guard_staff_update
before update on public.products
for each row execute function private.guard_product_staff_update();

create trigger stores_prevent_organization_change
before update of organization_id on public.stores
for each row execute function private.prevent_store_organization_change();

create policy stores_update_manager
on public.stores for update to authenticated
using ((select private.has_store_role(id, array['owner', 'manager'])))
with check ((select private.has_store_role(id, array['owner', 'manager'])));

create policy store_members_insert_owner
on public.store_members for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner'])));
create policy store_members_update_owner
on public.store_members for update to authenticated
using ((select private.has_store_role(store_id, array['owner'])))
with check ((select private.has_store_role(store_id, array['owner'])));
create policy store_members_delete_owner
on public.store_members for delete to authenticated
using ((select private.has_store_role(store_id, array['owner'])));

create policy store_hours_insert_manager on public.store_hours for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy store_hours_update_manager on public.store_hours for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy store_hours_delete_manager on public.store_hours for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

create policy menus_insert_manager on public.menus for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy menus_update_manager on public.menus for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy menus_delete_manager on public.menus for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

create policy menu_sections_insert_manager on public.menu_sections for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy menu_sections_update_manager on public.menu_sections for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy menu_sections_delete_manager on public.menu_sections for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

create policy products_insert_manager on public.products for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy products_update_operator on public.products for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager', 'staff'])));
create policy products_delete_manager on public.products for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

create policy menu_items_insert_manager on public.menu_items for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy menu_items_update_manager on public.menu_items for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy menu_items_delete_manager on public.menu_items for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

create policy option_groups_insert_manager on public.option_groups for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy option_groups_update_manager on public.option_groups for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy option_groups_delete_manager on public.option_groups for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

create policy option_values_insert_manager on public.option_values for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy option_values_update_manager on public.option_values for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy option_values_delete_manager on public.option_values for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

create policy product_option_groups_insert_manager on public.product_option_groups for insert to authenticated
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy product_option_groups_update_manager on public.product_option_groups for update to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])))
with check ((select private.has_store_role(store_id, array['owner', 'manager'])));
create policy product_option_groups_delete_manager on public.product_option_groups for delete to authenticated
using ((select private.has_store_role(store_id, array['owner', 'manager'])));

grant update on public.stores to authenticated;
grant insert, update, delete on public.store_members to authenticated;
grant insert, update, delete on public.store_hours, public.menus, public.menu_sections,
  public.products, public.menu_items, public.option_groups, public.option_values,
  public.product_option_groups to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_object_store_id(object_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
stable
as $$
declare
  path_parts text[];
  parsed_store_id uuid;
  parsed_product_id uuid;
begin
  path_parts := string_to_array(object_name, '/');

  if cardinality(path_parts) <> 5
    or path_parts[1] <> 'stores'
    or path_parts[3] <> 'products'
    or path_parts[5] <> 'main.webp'
  then
    return null;
  end if;

  parsed_store_id := path_parts[2]::uuid;
  parsed_product_id := path_parts[4]::uuid;

  if path_parts[2] <> parsed_store_id::text
    or path_parts[4] <> parsed_product_id::text
  then
    return null;
  end if;

  return parsed_store_id;
exception when invalid_text_representation then
  return null;
end;
$$;

revoke all on function private.storage_object_store_id(text) from public, anon, authenticated;
grant execute on function private.storage_object_store_id(text) to authenticated;

create policy product_images_select_member
on storage.objects for select to authenticated
using (bucket_id = 'product-images' and (select private.has_store_role(private.storage_object_store_id(name), array['owner', 'manager', 'staff'])));
create policy product_images_insert_manager
on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and (select private.has_store_role(private.storage_object_store_id(name), array['owner', 'manager'])));
create policy product_images_update_manager
on storage.objects for update to authenticated
using (bucket_id = 'product-images' and (select private.has_store_role(private.storage_object_store_id(name), array['owner', 'manager'])))
with check (bucket_id = 'product-images' and (select private.has_store_role(private.storage_object_store_id(name), array['owner', 'manager'])));
create policy product_images_delete_manager
on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and (select private.has_store_role(private.storage_object_store_id(name), array['owner', 'manager'])));
