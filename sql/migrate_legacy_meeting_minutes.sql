-- =========================================================
-- 기존 회의록(bigact kind='minute') → 관계형 테이블 1회 이관
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 전제:  sql/meeting_minutes.sql 로 두 테이블이 생성돼 있어야 함
-- 안전:  bigact 는 SELECT 만. legacy_id UNIQUE + ON CONFLICT 로 재실행 안전.
--
-- 기존 필드(실측): { id, title, date, participants[](팀원 이름), guests[](외부 이름),
--                    purpose, content, nextAgenda, nextDate }
-- 매핑: date→meeting_date, nextAgenda→next_agenda, nextDate→next_meeting_date,
--       guests→guest_names(text[]), participants→meeting_minute_members(이름→member_id)
-- =========================================================

-- ---------------------------------------------------------
-- 1) meeting_minutes 이관 (게스트 배열 → text[])
-- ---------------------------------------------------------
insert into meeting_minutes (title, meeting_date, purpose, content, next_agenda, next_meeting_date, guest_names, legacy_id, created_at, updated_at)
select
  b.data->>'title',
  (b.data->>'date')::date,
  nullif(btrim(b.data->>'purpose'), ''),
  nullif(btrim(b.data->>'content'), ''),
  nullif(btrim(b.data->>'nextAgenda'), ''),
  case when b.data->>'nextDate' ~ '^\d{4}-\d{2}-\d{2}$' then (b.data->>'nextDate')::date else null end,
  coalesce((select array_agg(g.value) from jsonb_array_elements_text(coalesce(b.data->'guests', '[]'::jsonb)) g(value) where btrim(g.value) <> ''), '{}'),
  b.id,
  coalesce(b.updated_at, now()),
  coalesce(b.updated_at, now())
from bigact b
where b.kind = 'minute'
  and length(trim(coalesce(b.data->>'title',''))) > 0
  and b.data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
on conflict (legacy_id) do nothing;

-- ---------------------------------------------------------
-- 2) 참석 팀원(participants 이름 배열) → meeting_minute_members
--    순서(ordinality) 보존, 짧은 이름 보정
-- ---------------------------------------------------------
insert into meeting_minute_members (meeting_minute_id, member_id, display_order)
select mm.id, m.id, (p.ord - 1)::int
from bigact b
join meeting_minutes mm on mm.legacy_id = b.id
cross join lateral jsonb_array_elements_text(coalesce(b.data->'participants', '[]'::jsonb)) with ordinality as p(value, ord)
join members m on m.name = case btrim(p.value)
     when '도은' then '김도은' when '가현' then '오가현' when '상아' then '성솔푸른'
     when '추가인원' then '성솔푸른' when 'FDSC' then '성솔푸른' when '윤서' then '송윤서'
     when '서린' then '채서린' when '설향' then '정설향' else btrim(p.value) end
where b.kind = 'minute'
on conflict (meeting_minute_id, member_id) do nothing;

-- =========================================================
-- 3) 확인용 SQL (필요할 때 주석 해제)
-- =========================================================
-- select (select count(*) from bigact where kind='minute')                as legacy_count,   -- 기존 vs 이관
--        (select count(*) from meeting_minutes where legacy_id is not null) as migrated_count;
-- select count(*) as attendee_links from meeting_minute_members;                             -- 참석자 연결 수
-- -- 참가자 이름이 members 와 매칭 안 된 기존 이름
-- select b.id, p.value as participant from bigact b
-- cross join lateral jsonb_array_elements_text(coalesce(b.data->'participants','[]'::jsonb)) as p(value)
-- where b.kind='minute' and not exists (select 1 from members m where m.name = case btrim(p.value)
--   when '도은' then '김도은' when '가현' then '오가현' when '상아' then '성솔푸른'
--   when '추가인원' then '성솔푸른' when 'FDSC' then '성솔푸른' when '윤서' then '송윤서'
--   when '서린' then '채서린' when '설향' then '정설향' else btrim(p.value) end);
-- select id, title, guest_names from meeting_minutes where array_length(guest_names,1) > 0;  -- 게스트 이관된 회의록
-- select b.id, b.data->>'title' t, b.data->>'date' d from bigact b                           -- 제목/날짜 결측
-- where b.kind='minute' and (coalesce(trim(b.data->>'title'),'')='' or not (b.data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'));
