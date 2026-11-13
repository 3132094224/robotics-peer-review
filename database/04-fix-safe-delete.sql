-- 兼容云端安全更新保护；只更新函数，不执行清空。
begin;
create or replace function public.review_reset(p_confirm boolean, p_expected_round_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_current_round text; v_new_round text; v_deleted integer;
begin
  if not public.review_is_admin() then raise exception '没有管理权限'; end if;
  if p_confirm is distinct from true then raise exception '请先确认清空全部评分'; end if;
  select round_id into v_current_round from public.review_settings where singleton for update;
  if not found then raise exception '活动尚未初始化'; end if;
  if p_expected_round_id is distinct from v_current_round then raise exception '评分轮次已更新，请刷新后台后重试'; end if;
  delete from public.review_ballots b
    where b.rater_id in (select s.id from public.review_students s);
  get diagnostics v_deleted = row_count;
  v_new_round := gen_random_uuid()::text;
  update public.review_settings set round_id = v_new_round, accepting = true where singleton;
  return jsonb_build_object('cleared_count', v_deleted, 'round_id', v_new_round, 'accepting', true);
end;
$$;
revoke all on function public.review_reset(boolean,text) from public,anon,authenticated;
grant execute on function public.review_reset(boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
