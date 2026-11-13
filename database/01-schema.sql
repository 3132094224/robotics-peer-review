-- 新建的 Supabase 项目中执行。不会删除任何现有数据。
-- 再执行教师资料中的 02-导入名单与管理员.sql。
begin;

create table public.review_students (
  id text primary key,
  sort_order integer not null unique check (sort_order > 0),
  name text not null,
  -- 保留旧版初始化数据的兼容字段；当前按姓名提交，不再读取或校验评价码。
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$')
);
create table public.review_settings (
  singleton boolean primary key default true check (singleton),
  course_title text not null,
  roster_version text not null,
  accepting boolean not null default true,
  round_id text not null default 'initial'
);
create table public.review_admins (
  email text primary key check (email = lower(email))
);
create table public.review_ballots (
  rater_id text primary key references public.review_students(id),
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  receipt uuid not null default gen_random_uuid(),
  submitted_at timestamptz not null default now()
);

alter table public.review_students enable row level security;
alter table public.review_settings enable row level security;
alter table public.review_admins enable row level security;
alter table public.review_ballots enable row level security;
-- 浏览器不能直接查询或修改表；统一经过下列校验函数。
revoke all on public.review_students, public.review_settings, public.review_admins, public.review_ballots from anon, authenticated;

create function public.review_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.review_admins a where a.email = lower(auth.jwt()->>'email')
  );
$$;

-- 最大余数法：余数相同，较低分档先分配。与前端使用同一取整规则。
create function public.review_quotas(p_n integer) returns integer[]
language sql immutable set search_path = '' as $$
  with weights(ord, pct) as (values (1,20),(2,30),(3,30),(4,20)),
  base as (
    select ord, (p_n*pct)/100 as seats, (p_n*pct)%100 as rem from weights
  ), ranked as (
    select *, row_number() over(order by rem desc, ord desc) as priority,
      p_n - sum(seats) over() as remaining from base
  )
  select array_agg((seats + case when priority <= remaining then 1 else 0 end)::integer order by ord) from ranked;
$$;

create function public.review_check_student(p_rater_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.review_students where id = p_rater_id)
    then raise exception '请从名单中选择自己的姓名'; end if;
end;
$$;

-- p_code 仅兼容旧缓存页面，可省略，不参与任何校验。
create function public.review_identity(p_rater_id text, p_code text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.review_check_student(p_rater_id);
  select jsonb_build_object(
    'name', s.name, 'accepting', cfg.accepting, 'roster_version', cfg.roster_version, 'round_id', cfg.round_id,
    'quotas', public.review_quotas((select count(*)::integer from public.review_students)),
    'submitted', b.rater_id is not null, 'submitted_at', b.submitted_at, 'receipt', b.receipt
  ) into v_result
  from public.review_students s cross join public.review_settings cfg
  left join public.review_ballots b on b.rater_id = s.id where s.id = p_rater_id;
  if v_result is null then raise exception '活动尚未完成初始化，请联系老师'; end if;
  return v_result;
end;
$$;

create function public.review_submit(p_rater_id text, p_round_id text default 'initial', p_roster_version text default null, p_scores jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.review_settings%rowtype;
  v_n integer;
  v_quota integer[];
  v_counts integer[];
  v_ballot public.review_ballots%rowtype;
begin
  perform public.review_check_student(p_rater_id);
  select * into v_settings from public.review_settings where singleton for share;
  if not found then raise exception '活动尚未初始化'; end if;
  if p_round_id is distinct from v_settings.round_id then
    raise exception '老师已清空上一轮评分，请返回重新开始评价' using detail = 'REVIEW_ROUND_CHANGED';
  end if;
  if p_roster_version is distinct from v_settings.roster_version then raise exception '名单版本已变化，请刷新页面'; end if;
  if not v_settings.accepting then raise exception '本次互评已经结束'; end if;
  select count(*)::integer into v_n from public.review_students;
  if jsonb_typeof(p_scores) is distinct from 'object' then raise exception '评分格式不正确'; end if;
  if (select count(*) from jsonb_object_keys(p_scores)) <> v_n then raise exception '请评价名单内所有同学，包括自己'; end if;
  if exists (select 1 from jsonb_each(p_scores) e left join public.review_students s on s.id = e.key where s.id is null)
    then raise exception '存在名单以外的评分对象'; end if;
  if exists (select 1 from jsonb_each(p_scores) e where jsonb_typeof(e.value) <> 'number')
    then raise exception '分数必须是数字'; end if;
  if exists (select 1 from jsonb_each_text(p_scores) e
    where e.value::numeric < 60 or e.value::numeric > 100 or e.value::numeric <> trunc(e.value::numeric))
    then raise exception '分数必须为 60 至 100 的整数'; end if;
  v_quota := public.review_quotas(v_n);
  select array[
    count(*) filter(where e.value::numeric >= 90),
    count(*) filter(where e.value::numeric >= 80 and e.value::numeric < 90),
    count(*) filter(where e.value::numeric >= 70 and e.value::numeric < 80),
    count(*) filter(where e.value::numeric < 70)
  ]::integer[] into v_counts from jsonb_each_text(p_scores) e;
  if v_counts <> v_quota then raise exception '分数档位人数不符合要求，请按页面显示的名额分配'; end if;
  -- 允许反复提交；同一姓名原子更新为最后一次完整评分，始终只计一票。
  insert into public.review_ballots(rater_id, scores) values (p_rater_id, p_scores)
    on conflict (rater_id) do update set
      scores = excluded.scores,
      receipt = gen_random_uuid(),
      submitted_at = clock_timestamp()
    returning * into v_ballot;
  return jsonb_build_object('submitted', true, 'receipt', v_ballot.receipt, 'submitted_at', v_ballot.submitted_at);
end;
$$;

create function public.review_dashboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.review_is_admin() then raise exception '仅指定的老师账号可以查看结果'; end if;
  -- 分母是实际评分数。未收到任何评分时为 NULL，绝不以零分代替。
  with received as (
    select e.key as student_id, sum(e.value::numeric) as total, count(*) as received_count,
      avg(e.value::numeric) as average
    from public.review_ballots b cross join lateral jsonb_each_text(b.scores) e group by e.key
  ), result_rows as (
    select s.id, s.sort_order, s.name, coalesce(r.total,0) as total,
      coalesce(r.received_count,0) as received_count, r.average,
      b.rater_id is not null as submitted, b.submitted_at
    from public.review_students s left join received r on r.student_id = s.id
    left join public.review_ballots b on b.rater_id = s.id
  )
  select jsonb_build_object(
    'students', (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order), '[]'::jsonb) from result_rows t),
    'total_students', (select count(*) from public.review_students),
    'submitted_count', (select count(*) from public.review_ballots),
    'accepting', (select accepting from public.review_settings where singleton),
    'roster_version', (select roster_version from public.review_settings where singleton),
    'round_id', (select round_id from public.review_settings where singleton),
    'refreshed_at', now()
  ) into v_result;
  return v_result;
end;
$$;

create function public.review_set_accepting(p_accepting boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.review_is_admin() then raise exception '没有管理权限'; end if;
  if p_accepting is null then raise exception '请选择是否开放提交'; end if;
  update public.review_settings set accepting = p_accepting where singleton;
  if not found then raise exception '活动尚未初始化'; end if;
  return jsonb_build_object('accepting', p_accepting);
end;
$$;

-- 仅允许老师清空当前轮。行锁与提交函数的 FOR SHARE 配合，防止旧轮并发提交混入新轮。
create function public.review_reset(p_confirm boolean, p_expected_round_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_current_round text; v_new_round text; v_deleted integer;
begin
  if not public.review_is_admin() then raise exception '没有管理权限'; end if;
  if p_confirm is distinct from true then raise exception '请先确认清空全部评分'; end if;
  select round_id into v_current_round from public.review_settings where singleton for update;
  if not found then raise exception '活动尚未初始化'; end if;
  if p_expected_round_id is distinct from v_current_round then raise exception '评分轮次已更新，请刷新后台后重试'; end if;
  delete from public.review_ballots;
  get diagnostics v_deleted = row_count;
  v_new_round := gen_random_uuid()::text;
  update public.review_settings set round_id = v_new_round, accepting = true where singleton;
  return jsonb_build_object('cleared_count', v_deleted, 'round_id', v_new_round, 'accepting', true);
end;
$$;

-- PostgreSQL 函数默认授予 PUBLIC 执行权，必须逐个收回。
revoke all on function public.review_is_admin() from public, anon, authenticated;
revoke all on function public.review_quotas(integer) from public, anon, authenticated;
revoke all on function public.review_check_student(text) from public, anon, authenticated;
revoke all on function public.review_identity(text,text) from public, anon, authenticated;
revoke all on function public.review_submit(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.review_dashboard() from public, anon, authenticated;
revoke all on function public.review_set_accepting(boolean) from public, anon, authenticated;
revoke all on function public.review_reset(boolean,text) from public, anon, authenticated;
grant execute on function public.review_identity(text,text) to anon, authenticated;
grant execute on function public.review_submit(text,text,text,jsonb) to anon, authenticated;
grant execute on function public.review_dashboard() to authenticated;
grant execute on function public.review_set_accepting(boolean) to authenticated;
grant execute on function public.review_reset(boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
