-- =========================================================
-- 타임시트 관계형 스키마 (bigact/jsonb → 관계형 테이블 전환)
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 특징: 로그인 없는 앱. 6명은 회원 계정이 아니라 앱 내부 고정 팀원 명부.
-- 안전: 이 파일은 members·timesheets 만 생성하며, 기존 bigact 테이블/데이터는
--       전혀 건드리지 않습니다. 여러 번 실행해도 안전하도록 작성했습니다.
-- =========================================================

-- ---------------------------------------------------------
-- 1) members : 프로젝트 고정 팀원 명부 (앱에서 CRUD 하지 않음, 조회 전용)
-- ---------------------------------------------------------
create table if not exists members (
  id            bigint generated always as identity primary key,
  name          varchar(30)  not null unique,
  role          varchar(50),
  color         varchar(20),
  display_order integer      not null default 0,
  is_active     boolean      not null default true,
  created_at    timestamptz  not null default now()
);

-- ---------------------------------------------------------
-- 2) timesheets : 작업 기록 (member_id로 members 참조)
-- ---------------------------------------------------------
create table if not exists timesheets (
  id          bigint generated always as identity primary key,
  member_id   bigint       not null
                references members(id) on delete restrict,  -- 기록 있는 팀원 삭제 금지
  work_date   date         not null default current_date,
  hours       numeric(5,2) not null check (hours > 0 and hours <= 24),
  description  text        not null,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

-- 조회 성능용 인덱스 (선택)
create index if not exists timesheets_member_id_idx on timesheets(member_id);
create index if not exists timesheets_work_date_idx on timesheets(work_date desc);

-- ---------------------------------------------------------
-- 3) 초기 팀원 6명 (중복 실행 시 같은 이름은 무시)
-- ---------------------------------------------------------
insert into members (name, role, color, display_order) values
  ('김도은', 'PM',            '#fece00', 1),
  ('오가현', '회계·홍보 운영', '#fea1cd', 2),
  ('성솔푸른', '대관·섭외',      '#ff7300', 3),
  ('송윤서', '대관·섭외',      '#31cc66', 4),
  ('채서린', '홍보·운영',      '#00a3fe', 5),
  ('정설향', '홍보·운영',      '#fea501', 6)
on conflict (name) do nothing;

-- ---------------------------------------------------------
-- 4) RLS 정책 (로그인 없는 앱 → anon 역할 기준)
--    · members    : anon 은 SELECT 만
--    · timesheets : anon 은 SELECT / INSERT / UPDATE / DELETE 모두 허용
--    재실행 시 정책 이름 충돌을 막기 위해 먼저 DROP IF EXISTS
-- ---------------------------------------------------------
alter table members    enable row level security;
alter table timesheets enable row level security;

-- 테이블 접근 권한 (RLS는 접근 후 행 필터, 권한 자체는 grant 로 부여)
grant usage on schema public to anon;
grant select                         on members    to anon;
grant select, insert, update, delete on timesheets to anon;

-- members: 조회만
drop policy if exists members_anon_select on members;
create policy members_anon_select on members
  for select to anon using (true);

-- timesheets: CRUD
drop policy if exists timesheets_anon_select on timesheets;
create policy timesheets_anon_select on timesheets
  for select to anon using (true);

drop policy if exists timesheets_anon_insert on timesheets;
create policy timesheets_anon_insert on timesheets
  for insert to anon with check (true);

drop policy if exists timesheets_anon_update on timesheets;
create policy timesheets_anon_update on timesheets
  for update to anon using (true) with check (true);

drop policy if exists timesheets_anon_delete on timesheets;
create policy timesheets_anon_delete on timesheets
  for delete to anon using (true);

-- =========================================================
-- 5) 확인용 SQL (필요할 때 주석 해제 후 실행)
-- =========================================================
-- -- (a) 팀원을 표시 순서대로 조회
-- select id, name, role, color, display_order, is_active
-- from members
-- order by display_order;
--
-- -- (b) 작업 기록을 팀원 이름과 함께 조회 (JOIN)
-- select t.id,
--        t.member_id,
--        m.name  as member_name,
--        m.color as member_color,
--        t.work_date,
--        t.hours,
--        t.description,
--        t.created_at,
--        t.updated_at
-- from timesheets t
-- join members m on m.id = t.member_id
-- order by t.work_date desc, t.created_at desc;
