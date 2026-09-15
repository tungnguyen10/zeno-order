create or replace function public.consume_public_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  current_time_value timestamptz := clock_timestamp();
  window_started_at_value timestamptz;
  expires_at_value timestamptz;
  request_count_value integer;
  retry_after_value integer;
begin
  if p_scope is null
    or char_length(btrim(p_scope)) not between 1 and 100
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 10000
    or p_window_seconds not between 1 and 86400
  then
    raise exception 'INVALID_RATE_LIMIT_INPUT' using errcode = 'P0001';
  end if;

  window_started_at_value := pg_catalog.to_timestamp(
    floor(extract(epoch from current_time_value) / p_window_seconds) * p_window_seconds
  );
  expires_at_value := window_started_at_value + pg_catalog.make_interval(secs => p_window_seconds);

  delete from public.public_rate_limits rate_limit
  where rate_limit.scope = btrim(p_scope)
    and rate_limit.key_hash = p_key_hash
    and rate_limit.expires_at <= current_time_value;

  insert into public.public_rate_limits (
    scope, key_hash, window_started_at, request_count, expires_at
  ) values (
    btrim(p_scope), p_key_hash, window_started_at_value, 1, expires_at_value
  )
  on conflict (scope, key_hash, window_started_at)
  do update set request_count = public.public_rate_limits.request_count + 1
  returning request_count into request_count_value;

  retry_after_value := greatest(
    1,
    ceil(extract(epoch from (expires_at_value - current_time_value)))::integer
  );

  return jsonb_build_object(
    'allowed', request_count_value <= p_limit,
    'request_count', request_count_value,
    'remaining', greatest(p_limit - request_count_value, 0),
    'retry_after', retry_after_value
  );
end;
$$;

revoke all on function public.consume_public_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, text, integer, integer)
  to service_role;
