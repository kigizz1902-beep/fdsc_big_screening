-- =========================================================
-- 기존 캘린더 일반 일정(bigact kind='event') → calendar_events 1회 이관
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 전제:  sql/calendar_events.sql 로 calendar_events 가 이미 생성돼 있어야 함
-- 안전:  bigact 는 오직 SELECT 만 함 (원본 삭제·수정 없음).
--        legacy_id UNIQUE + ON CONFLICT DO NOTHING 으로 여러 번 실행해도
--        같은 일정이 두 번 들어가지 않음.
--
-- 기존 데이터 매핑:
--   기존 id → legacy_id / name → title / sector → event_type
--   date → start_date / dateEnd → end_date / time → start_time / memo → memo
--   기존 updated_at → created_at·updated_at (없으면 NOW())
--   빈 종료일·빈 시간·빈 메모는 NULL 로 저장
--
-- '이번주 목표' 종료일 보완 여부(사전 전수 확인 결과):
--   현재 bigact 의 weekly_goal 성격 이벤트 2건 모두 dateEnd 가 채워져 있어
--   보완 대상이 0건 → 별도 보완 로직 없이 그대로 이관한다.
--   (앱 UI 가 '이번주 목표' 저장 시 항상 일~토 한 주를 강제로 채우므로
--    향후에도 종료일 없는 weekly_goal 은 생기지 않음)
-- =========================================================

insert into calendar_events
  (title, event_type, start_date, end_date, start_time, memo, created_at, updated_at, legacy_id)
select
  trim(b.data->>'name'),
  case b.data->>'sector'
    when '미팅'        then 'meeting'
    when '상영회'      then 'screening'
    when '기타'        then 'other'
    when '이번주 목표' then 'weekly_goal'
    when '이번 주 목표' then 'weekly_goal'
    when '이번주목표'  then 'weekly_goal'
    else 'other'                                   -- 알 수 없는 섹터는 '기타'로
  end,
  (b.data->>'date')::date,
  nullif(b.data->>'dateEnd', '')::date,
  nullif(b.data->>'time', '')::time,
  nullif(trim(coalesce(b.data->>'memo', '')), ''),
  coalesce(b.updated_at, now()),
  coalesce(b.updated_at, now()),
  b.id
from bigact b
where b.kind = 'event'
  -- 제목·시작일이 유효한 행만 (CHECK 제약 위반으로 전체 INSERT 가 실패하지 않도록 사전 필터)
  and coalesce(trim(b.data->>'name'), '') <> ''
  and (b.data->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
  -- 종료일이 있으면 형식이 맞고 시작일 이상이어야 함
  and (nullif(b.data->>'dateEnd', '') is null
       or ((b.data->>'dateEnd') ~ '^\d{4}-\d{2}-\d{2}$'
           and (b.data->>'dateEnd')::date >= (b.data->>'date')::date))
  -- 시간이 있으면 HH:MM 형식이어야 함
  and (nullif(b.data->>'time', '') is null
       or (b.data->>'time') ~ '^\d{1,2}:\d{2}')
on conflict (legacy_id) do nothing;

-- =========================================================
-- 확인용 SQL (필요할 때 주석 해제 후 실행)
-- =========================================================
-- -- (a) bigact 의 기존 일반 이벤트 수
-- select count(*) as legacy_event_count from bigact where kind = 'event';
--
-- -- (b) 이관된(=legacy_id 가 있는) calendar_events 수 — (a)와 같아야 정상
-- select count(*) as migrated_count from calendar_events where legacy_id is not null;
--
-- -- (c) event_type 별 이관 개수 (기존: 미팅 44 · 기타 61 · 상영회 3 · 이번주 목표 2)
-- select event_type, count(*) from calendar_events where legacy_id is not null group by event_type;
--
-- -- (d) 이관되지 않은 기존 sector 값 진단 (0건이어야 정상)
-- select b.id, b.data->>'sector' as sector, b.data->>'name' as name
-- from bigact b
-- where b.kind = 'event'
--   and not exists (select 1 from calendar_events c where c.legacy_id = b.id);
--
-- -- (e) 날짜가 없거나 형식이 잘못돼 건너뛴 기존 이벤트 진단
-- select b.id, b.data->>'name' as name, b.data->>'date' as date, b.data->>'dateEnd' as date_end, b.data->>'time' as time
-- from bigact b
-- where b.kind = 'event'
--   and (coalesce(trim(b.data->>'name'), '') = ''
--        or (b.data->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
--        or (nullif(b.data->>'dateEnd','') is not null
--            and ((b.data->>'dateEnd') !~ '^\d{4}-\d{2}-\d{2}$'
--                 or (b.data->>'dateEnd')::date < (b.data->>'date')::date)));
--
-- -- (f) 기존 값 ↔ 새 값 비교 목록 (샘플 검수용)
-- select c.legacy_id, b.data->>'name' as old_name, c.title as new_title,
--        b.data->>'sector' as old_sector, c.event_type as new_type,
--        b.data->>'date' as old_date, c.start_date as new_start,
--        b.data->>'dateEnd' as old_end, c.end_date as new_end,
--        b.data->>'time' as old_time, c.start_time as new_time
-- from calendar_events c
-- join bigact b on b.id = c.legacy_id
-- order by c.start_date asc, c.start_time asc nulls last, c.created_at asc;
