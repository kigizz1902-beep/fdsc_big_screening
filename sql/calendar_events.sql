-- =========================================================
-- 캘린더 일반 일정 스키마 (bigact/jsonb → 관계형)
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 원칙: 캘린더에서 "직접 등록한 일반 일정"만 여기에 저장한다.
--   · 회의록 날짜 → meeting_minutes (복제 금지)
--   · 영화관 일정 → cinema_screening_dates (복제 금지)
--   · 작업 기록  → timesheets (복제 금지)
--   화면에서 JS 로 조합만 하며, 다른 테이블의 날짜를 여기에 INSERT 하지 않는다.
-- 안전: 기존 테이블·bigact 는 건드리지 않음. 재실행 안전.
--
-- ⚠️ 보안 한계(로그인 없음): anon 역할이라 앱 주소 + anon key 를 아는 사람은
--    일반 일정을 등록·수정·삭제할 수 있습니다.
-- =========================================================

create table if not exists calendar_events (
  id         bigint generated always as identity primary key,
  title      varchar(150) not null check (length(trim(title)) > 0),
  event_type varchar(30)  not null check (event_type in ('meeting','screening','other','weekly_goal')),
  start_date date         not null,
  end_date   date         check (end_date is null or end_date >= start_date),
  start_time time,
  memo       text,
  legacy_id  text,
  created_at timestamptz  not null default now(),
  updated_at timestamptz  not null default now()
);
create unique index if not exists calendar_events_legacy_id_uidx on calendar_events (legacy_id); -- NULL 다수 허용
create index if not exists calendar_events_start_date_idx on calendar_events (start_date);
create index if not exists calendar_events_end_date_idx   on calendar_events (end_date);
create index if not exists calendar_events_type_idx       on calendar_events (event_type);
create index if not exists calendar_events_updated_idx    on calendar_events (updated_at desc);

-- event_type 화면 표시: meeting→미팅 / screening→상영회 / other→기타 / weekly_goal→이번주 목표
-- (표시명·색상은 app.js 의 SECTORS 설정에서 관리, DB엔 코드만 저장)

-- =========================================================
-- RLS + 권한 (로그인 없음 → anon CRUD)
-- =========================================================
alter table calendar_events enable row level security;
grant usage on schema public to anon;
grant select, insert, update, delete on calendar_events to anon;

drop policy if exists calendar_events_anon_select on calendar_events;
create policy calendar_events_anon_select on calendar_events for select to anon using (true);
drop policy if exists calendar_events_anon_insert on calendar_events;
create policy calendar_events_anon_insert on calendar_events for insert to anon with check (true);
drop policy if exists calendar_events_anon_update on calendar_events;
create policy calendar_events_anon_update on calendar_events for update to anon using (true) with check (true);
drop policy if exists calendar_events_anon_delete on calendar_events;
create policy calendar_events_anon_delete on calendar_events for delete to anon using (true);

-- =========================================================
-- 확인용 SQL (기간 조회 기준: start_date <= 종료일 AND coalesce(end_date,start_date) >= 시작일)
-- =========================================================
-- select * from calendar_events order by start_date asc, start_time asc nulls last, created_at asc;   -- (1)
-- -- (2) 특정 날짜(:d)에 포함되는 기간 일정
-- select * from calendar_events where start_date <= :d and coalesce(end_date, start_date) >= :d;
-- -- (3) 특정 주(:s ~ :e)와 겹치는 일정
-- select * from calendar_events where start_date <= :e and coalesce(end_date, start_date) >= :s;
-- select event_type, count(*) from calendar_events group by event_type;                                -- (4)
-- select * from calendar_events where end_date is not null;                                            -- (5) 기간 일정
-- select * from calendar_events where event_type='weekly_goal';                                        -- (6) 이번 주 목표
-- select * from calendar_events where end_date is not null and end_date < start_date;                  -- (7) 잘못된 일정(없어야 정상)
