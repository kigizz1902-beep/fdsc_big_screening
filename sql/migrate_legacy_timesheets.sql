-- =========================================================
-- 기존 타임스탬프(bigact kind='ts') → 새 timesheets 테이블 1회 이관
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 전제:  sql/timesheets.sql 로 members·timesheets 가 이미 생성돼 있어야 함
-- 안전:  bigact 는 오직 SELECT 만 함 (원본 삭제·수정 없음). 여러 번 실행해도
--        legacy_id UNIQUE + ON CONFLICT 로 같은 기록이 두 번 들어가지 않음.
-- 참고:  현재 이 프로젝트의 bigact 에는 kind='ts' 행이 0건일 수 있음(이미 정리됨).
--        그 경우 이 스크립트는 0건을 이관하며 아무 부작용이 없음.
-- =========================================================

-- ---------------------------------------------------------
-- 1) 이관 추적용 컬럼 + 중복 방지 UNIQUE 인덱스
--    (앱이 새로 만든 행은 legacy_id 가 NULL → 여러 NULL 은 UNIQUE 에 걸리지 않음)
-- ---------------------------------------------------------
alter table timesheets add column if not exists legacy_id text;
create unique index if not exists timesheets_legacy_id_uidx on timesheets (legacy_id);

-- ---------------------------------------------------------
-- 2) bigact(kind='ts') → timesheets 이관
--    이름 매핑: 옛 짧은 이름/별칭 → members.name (전체 이름)
--    유효하지 않은 행(이름 미매칭, 날짜 형식 오류, 시간 범위 밖)은 건너뜀
-- ---------------------------------------------------------
insert into timesheets (member_id, work_date, hours, description, created_at, updated_at, legacy_id)
select
  m.id,
  (b.data->>'date')::date,
  (b.data->>'hours')::numeric,
  coalesce(b.data->>'work', ''),
  coalesce(b.updated_at, now()),
  coalesce(b.updated_at, now()),
  b.id
from bigact b
join members m
  on m.name = case b.data->>'name'
       when '도은'      then '김도은'
       when '가현'      then '오가현'
       when '상아'      then '성솔푸른'
       when '추가인원'  then '성솔푸른'
       when 'FDSC'      then '성솔푸른'
       when '윤서'      then '송윤서'
       when '서린'      then '채서린'
       when '설향'      then '정설향'
       else b.data->>'name'   -- 이미 전체 이름이면 그대로
     end
where b.kind = 'ts'
  and b.data->>'date'  ~ '^\d{4}-\d{2}-\d{2}$'            -- 날짜 형식 유효
  and b.data->>'hours' ~ '^[0-9]+(\.[0-9]+)?$'            -- 숫자
  and (b.data->>'hours')::numeric > 0
  and (b.data->>'hours')::numeric <= 24                   -- CHECK 제약 통과 범위
on conflict (legacy_id) do nothing;

-- =========================================================
-- 3) 확인용 SQL (필요할 때 주석 해제 후 실행)
-- =========================================================
-- -- (a) bigact 의 기존 작업 기록 수
-- select count(*) as legacy_ts_count from bigact where kind = 'ts';
--
-- -- (b) 이관된(=legacy_id 가 있는) timesheets 수
-- select count(*) as migrated_count from timesheets where legacy_id is not null;
--
-- -- (c) members 와 JOIN 한 이관 결과 목록
-- select t.id, t.legacy_id, m.name as member_name, t.work_date, t.hours, t.description, t.created_at
-- from timesheets t
-- join members m on m.id = t.member_id
-- where t.legacy_id is not null
-- order by t.work_date desc, t.created_at desc;
--
-- -- (d) 이름이 members 와 매칭되지 않아 건너뛴 기록 진단
-- select b.id, b.data->>'name' as legacy_name, b.data->>'date' as date, b.data->>'hours' as hours
-- from bigact b
-- where b.kind = 'ts'
--   and not exists (
--     select 1 from members m where m.name = case b.data->>'name'
--       when '도은' then '김도은' when '가현' then '오가현' when '상아' then '성솔푸른'
--       when '추가인원' then '성솔푸른' when 'FDSC' then '성솔푸른' when '윤서' then '송윤서'
--       when '서린' then '채서린' when '설향' then '정설향' else b.data->>'name' end
--   );
