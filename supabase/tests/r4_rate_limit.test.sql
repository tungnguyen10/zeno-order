begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function(
  'public', 'consume_public_rate_limit', array['text', 'text', 'integer', 'integer'],
  'server-only fixed-window rate limiter exists'
);

select is(
  public.consume_public_rate_limit('orders:r4-test', repeat('a', 64), 2, 60)->>'allowed',
  'true', 'first request is allowed'
);
select is(
  public.consume_public_rate_limit('orders:r4-test', repeat('a', 64), 2, 60)->>'request_count',
  '2', 'same hashed key increments within the window'
);
select is(
  public.consume_public_rate_limit('orders:r4-test', repeat('a', 64), 2, 60)->>'allowed',
  'false', 'request over the limit is rejected'
);
select cmp_ok(
  (select request_count from public.public_rate_limits
    where scope = 'orders:r4-test' and key_hash = repeat('a', 64)),
  '>=', 3, 'over-limit requests remain counted'
);
select is(
  public.consume_public_rate_limit('orders:r4-test', repeat('b', 64), 2, 60)->>'allowed',
  'true', 'different privacy-preserving key has an independent counter'
);
select cmp_ok(
  (public.consume_public_rate_limit('orders:r4-test', repeat('a', 64), 2, 60)->>'retry_after')::integer,
  '>=', 1, 'rejection includes a positive retry delay'
);

select throws_ok(
  $$select public.consume_public_rate_limit('orders', '192.0.2.1', 2, 60)$$,
  'P0001', 'INVALID_RATE_LIMIT_INPUT', 'raw IP-shaped values are rejected'
);
select throws_ok(
  $$select public.consume_public_rate_limit('orders', repeat('a', 64), 0, 60)$$,
  'P0001', 'INVALID_RATE_LIMIT_INPUT', 'non-positive limits are rejected'
);
select ok(
  not has_function_privilege('anon', 'public.consume_public_rate_limit(text,text,integer,integer)', 'EXECUTE'),
  'anon cannot consume the privileged counter directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.consume_public_rate_limit(text,text,integer,integer)', 'EXECUTE'),
  'authenticated cannot consume the privileged counter directly'
);
select ok(
  has_function_privilege('service_role', 'public.consume_public_rate_limit(text,text,integer,integer)', 'EXECUTE'),
  'service role can consume the counter'
);

select * from finish();
rollback;
