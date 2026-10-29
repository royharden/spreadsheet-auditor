-- Atomic attempt reservations. No workbook values, formulas, bundles or notes are persisted.
create table public.explain_quota_config (
  singleton boolean primary key default true check (singleton),
  user_daily_cap integer not null check (user_daily_cap > 0),
  global_daily_cap integer not null check (global_daily_cap > 0)
);
insert into public.explain_quota_config (singleton, user_daily_cap, global_daily_cap)
values (true, 1000, 10000);

create table public.explain_quota_user (
  user_id uuid not null references auth.users(id),
  day date not null,
  bundles_reserved bigint not null check (bundles_reserved >= 0),
  primary key (user_id, day)
);
create table public.explain_quota_global (
  day date primary key,
  bundles_reserved bigint not null check (bundles_reserved >= 0)
);
create table public.explain_reservations (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id),
  bundles integer not null check (bundles between 1 and 200),
  created_at timestamptz not null default now()
);

alter table public.explain_quota_config enable row level security;
alter table public.explain_quota_user enable row level security;
alter table public.explain_quota_global enable row level security;
alter table public.explain_reservations enable row level security;
revoke all on table public.explain_quota_config, public.explain_quota_user,
  public.explain_quota_global, public.explain_reservations from public, anon, authenticated;

create function public.reserve_explain_quota(p_request_id uuid, p_n integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'UTC')::date;
  v_user_cap integer;
  v_global_cap integer;
  v_attempts bigint;
  v_user_reserved bigint;
  v_global_reserved bigint;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_request_id is null or p_n is null or p_n < 1 or p_n > 200 then
    raise exception 'Invalid quota request' using errcode = '22023';
  end if;

  select user_daily_cap, global_daily_cap into v_user_cap, v_global_cap
    from public.explain_quota_config where singleton = true;
  if not found then
    raise exception 'Quota configuration missing';
  end if;
  -- One first attempt plus at most one retry, reserved once for the whole invocation.
  v_attempts := 2::bigint * p_n;

  -- Global UUID primary key refuses replays. Every later exception rolls this insert back.
  insert into public.explain_reservations (request_id, user_id, bundles)
    values (p_request_id, v_user, p_n);

  -- Always take global then user locks to keep concurrent reservations in one lock order.
  -- INSERT's WHERE protects a new day too, not only the ON CONFLICT update path.
  insert into public.explain_quota_global as g (day, bundles_reserved)
    select v_day, v_attempts where v_attempts <= v_global_cap
    on conflict (day) do update
      set bundles_reserved = g.bundles_reserved + excluded.bundles_reserved
      where g.bundles_reserved + excluded.bundles_reserved <= v_global_cap
    returning bundles_reserved into v_global_reserved;
  if not found then
    raise exception 'Global quota exceeded';
  end if;

  insert into public.explain_quota_user as u (user_id, day, bundles_reserved)
    select v_user, v_day, v_attempts where v_attempts <= v_user_cap
    on conflict (user_id, day) do update
      set bundles_reserved = u.bundles_reserved + excluded.bundles_reserved
      where u.bundles_reserved + excluded.bundles_reserved <= v_user_cap
    returning bundles_reserved into v_user_reserved;
  if not found then
    raise exception 'User quota exceeded';
  end if;

  return (v_user_cap - v_user_reserved)::integer;
end;
$$;

revoke all on function public.reserve_explain_quota(uuid, integer) from public;
grant execute on function public.reserve_explain_quota(uuid, integer) to authenticated;
