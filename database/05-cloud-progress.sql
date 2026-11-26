-- 新增独立的保存进度表。既有正式评分不被覆盖或清空。
begin;
create table if not exists public.review_drafts (
  rater_id text primary key references public.review_students(id),
  round_id text not null,
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  saved_at timestamptz not null default clock_timestamp(),
  revision integer not null default 1
);
alter table public.review_drafts enable row level security;
revoke all on public.review_drafts from public,anon,authenticated;
create or replace function public.review_save_draft(p_rater_id text, p_round_id text, p_roster_version text, p_scores jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_settings public.review_settings%rowtype; v_counts integer[]; v_limits integer[]; v_draft public.review_drafts%rowtype;
begin
  perform public.review_check_student(p_rater_id);
  select * into v_settings from public.review_settings where singleton for share;
  if not found then raise exception '活动尚未初始化'; end if;
  if p_round_id is distinct from v_settings.round_id then raise exception '老师已清空上一轮评分，请返回重新开始评价' using detail='REVIEW_ROUND_CHANGED'; end if;
  if p_roster_version is distinct from v_settings.roster_version then raise exception '名单版本已变化，请刷新页面'; end if;
  if not v_settings.accepting then raise exception '本次互评已暂停，暂时不能保存'; end if;
  if jsonb_typeof(p_scores) is distinct from 'object' then raise exception '评分格式不正确'; end if;
  if exists(select 1 from jsonb_each(p_scores) e left join public.review_students s on s.id=e.key where s.id is null) then raise exception '存在名单以外的评分对象'; end if;
  if exists(select 1 from jsonb_each(p_scores) e where jsonb_typeof(e.value)<>'number') then raise exception '分数必须是数字'; end if;
  if exists(select 1 from jsonb_each_text(p_scores) e where e.value::numeric<60 or e.value::numeric>100 or e.value::numeric<>trunc(e.value::numeric)) then raise exception '分数必须为 60 至 100 的整数'; end if;
  select array[count(*) filter(where e.value::numeric>=90),count(*) filter(where e.value::numeric>=80 and e.value::numeric<90),count(*) filter(where e.value::numeric>=70 and e.value::numeric<80),count(*) filter(where e.value::numeric<70)]::integer[] into v_counts from jsonb_each_text(p_scores) e;
  v_limits:=public.review_quotas((select count(*)::integer from public.review_students));
  if v_counts[1]>v_limits[1] or v_counts[2]>v_limits[2] or v_counts[3]>v_limits[3] or v_counts[4]>v_limits[4] then raise exception '分档人数超过名额，请先调整'; end if;
  insert into public.review_drafts(rater_id,round_id,scores) values(p_rater_id,p_round_id,p_scores)
    on conflict(rater_id) do update set round_id=excluded.round_id,scores=excluded.scores,saved_at=clock_timestamp(),revision=public.review_drafts.revision+1
    returning * into v_draft;
  return jsonb_build_object('saved',true,'saved_at',v_draft.saved_at,'revision',v_draft.revision);
end;
$$;

create or replace function public.review_identity(p_rater_id text, p_code text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.review_check_student(p_rater_id);
  select jsonb_build_object(
    'name', s.name, 'accepting', cfg.accepting, 'roster_version', cfg.roster_version, 'round_id', cfg.round_id,
    'quotas', public.review_quotas((select count(*)::integer from public.review_students)),
    'submitted', b.rater_id is not null, 'submitted_at', b.submitted_at, 'receipt', b.receipt,
    'draft', case when d.rater_id is null then null else jsonb_build_object('scores',d.scores,'saved_at',d.saved_at,'revision',d.revision) end
  ) into v_result
  from public.review_students s cross join public.review_settings cfg
  left join public.review_ballots b on b.rater_id = s.id
  left join public.review_drafts d on d.rater_id=s.id and d.round_id=cfg.round_id where s.id = p_rater_id;
  if v_result is null then raise exception '活动尚未完成初始化，请联系老师'; end if;
  return v_result;
end;
$$;

create or replace function public.review_submit(p_rater_id text, p_round_id text default 'initial', p_roster_version text default null, p_scores jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.review_settings%rowtype;
  v_n integer;
  v_quota integer[];
  v_counts integer[];
  v_ballot public.review_ballots%rowtype;
  v_saved jsonb;
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
  v_saved:=public.review_save_draft(p_rater_id,p_round_id,p_roster_version,p_scores);
  return jsonb_build_object('submitted', true, 'receipt', v_ballot.receipt, 'submitted_at', v_ballot.submitted_at,'saved_at',v_saved->'saved_at','draft_revision',v_saved->'revision');
end;
$$;

create or replace function public.review_reset(p_confirm boolean, p_expected_round_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_current_round text; v_new_round text; v_deleted integer; v_drafts_deleted integer;
begin
  if not public.review_is_admin() then raise exception '没有管理权限'; end if;
  if p_confirm is distinct from true then raise exception '请先确认清空全部评分'; end if;
  select round_id into v_current_round from public.review_settings where singleton for update;
  if not found then raise exception '活动尚未初始化'; end if;
  if p_expected_round_id is distinct from v_current_round then raise exception '评分轮次已更新，请刷新后台后重试'; end if;
  delete from public.review_ballots b
    where b.rater_id in (select s.id from public.review_students s);
  get diagnostics v_deleted = row_count;
  delete from public.review_drafts d where d.rater_id in(select s.id from public.review_students s);
  get diagnostics v_drafts_deleted = row_count;
  v_new_round := gen_random_uuid()::text;
  update public.review_settings set round_id = v_new_round, accepting = true where singleton;
  return jsonb_build_object('cleared_count', v_deleted, 'cleared_draft_count',v_drafts_deleted,'round_id', v_new_round, 'accepting', true);
end;
$$;
revoke all on function public.review_save_draft(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.review_identity(text,text) from public,anon,authenticated;
revoke all on function public.review_submit(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.review_reset(boolean,text) from public,anon,authenticated;
grant execute on function public.review_save_draft(text,text,text,jsonb) to anon,authenticated;
grant execute on function public.review_identity(text,text) to anon,authenticated;
grant execute on function public.review_submit(text,text,text,jsonb) to anon,authenticated;
grant execute on function public.review_reset(boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
