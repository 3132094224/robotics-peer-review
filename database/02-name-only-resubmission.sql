-- 删除评价码校验，允许按姓名重复提交，以最后一次完整提交为准。
-- 保留已有名单、老师账号及所有正式评分，不重建表、不清空数据。
begin;
create or replace function public.review_check_student(p_rater_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.review_students where id = p_rater_id)
    then raise exception '请从名单中选择自己的姓名'; end if;
end;
$$;

create or replace function public.review_identity(p_rater_id text, p_code text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.review_check_student(p_rater_id);
  select jsonb_build_object(
    'name', s.name, 'accepting', cfg.accepting, 'roster_version', cfg.roster_version,
    'quotas', public.review_quotas((select count(*)::integer from public.review_students)),
    'submitted', b.rater_id is not null, 'submitted_at', b.submitted_at, 'receipt', b.receipt
  ) into v_result
  from public.review_students s cross join public.review_settings cfg
  left join public.review_ballots b on b.rater_id = s.id where s.id = p_rater_id;
  if v_result is null then raise exception '活动尚未完成初始化，请联系老师'; end if;
  return v_result;
end;
$$;

create or replace function public.review_submit(p_rater_id text, p_code text default '', p_roster_version text default null, p_scores jsonb default null) returns jsonb
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
revoke all on function public.review_check_student(text) from public, anon, authenticated;
revoke all on function public.review_identity(text,text) from public, anon, authenticated;
revoke all on function public.review_submit(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.review_identity(text,text) to anon, authenticated;
grant execute on function public.review_submit(text,text,text,jsonb) to anon, authenticated;
drop function if exists public.review_check_code(text,text);
notify pgrst, 'reload schema';
commit;
