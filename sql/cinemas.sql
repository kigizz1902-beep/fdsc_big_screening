-- =========================================================
-- 영화관·대관처 관계형 스키마 (bigact/jsonb → 관계형 테이블 전환)
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 구조: cinemas 1:N (cinema_members·cinema_contact_logs·cinema_screening_dates·cinema_links)
--       cinema_members / cinema_contact_logs 는 members 참조
-- 안전: 기존 members·timesheets·accounting_*·ideas·bigact 는 건드리지 않음. 재실행 안전.
-- Storage 미사용(파일 업로드 없음). 외부 링크는 cinema_links 에 URL 로만 저장.
--
-- ⚠️ 보안 한계(로그인 없음): anon 역할로 접근하므로 앱 주소 + anon key 를 아는 사람은
--    영화관 데이터를 등록·수정·삭제할 수 있습니다. member_id 는 인증된 사용자가 아니라
--    화면에서 고른 '담당자 표시'일 뿐입니다. 민감하면 이후 Auth + 역할 RLS 로 강화하세요.
-- =========================================================

-- ---------------------------------------------------------
-- 1-1) cinemas : 장소 기본 정보
-- ---------------------------------------------------------
create table if not exists cinemas (
  id                    bigint generated always as identity primary key,
  name                  varchar(120) not null check (length(trim(name)) > 0),
  region                varchar(50),
  district              varchar(50),
  address               text,
  rental_cost           numeric(14,2) check (rental_cost is null or rental_cost >= 0),
  capacity              integer        check (capacity is null or capacity > 0),
  status                varchar(30)  not null,
  primary_contact_name  varchar(80),
  primary_contact_phone varchar(40),
  primary_contact_email varchar(150),
  summary               text,
  notes                 text,
  is_archived           boolean      not null default false,
  is_pinned             boolean      not null default false,   -- 상단 고정
  liked_by              text[]       not null default '{}',    -- 좋아요 누른 기기 id 목록(기기 기준)
  legacy_id             text,
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now()
);
create unique index if not exists cinemas_legacy_id_uidx on cinemas (legacy_id); -- NULL 다수 허용(중복 이관 방지)
create index if not exists cinemas_status_idx      on cinemas (status);
create index if not exists cinemas_region_idx      on cinemas (region);
create index if not exists cinemas_district_idx    on cinemas (district);
create index if not exists cinemas_rental_cost_idx on cinemas (rental_cost);
create index if not exists cinemas_updated_at_idx  on cinemas (updated_at desc);
create index if not exists cinemas_is_archived_idx on cinemas (is_archived);
create index if not exists cinemas_is_pinned_idx   on cinemas (is_pinned);
-- 참고: 이름+address UNIQUE 는 강제하지 않는다.
-- 기존 데이터에 이름·주소가 동일한 항목(예: 테스트/테스트)이 있어 이관을 막기 때문.
-- (동일 장소 중복은 필요 시 앱 화면에서 경고로 처리)

-- ---------------------------------------------------------
-- 1-2) cinema_members : 장소 ↔ 담당 팀원 (N:M)
-- ---------------------------------------------------------
create table if not exists cinema_members (
  cinema_id      bigint  not null references cinemas(id) on delete cascade,
  member_id      bigint  not null references members(id) on delete restrict,
  responsibility varchar(30),
  is_lead        boolean not null default false,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  primary key (cinema_id, member_id)
);
create index if not exists cinema_members_member_id_idx on cinema_members (member_id);
-- 한 장소에 대표 담당자(is_lead=true)는 1명만
create unique index if not exists cinema_members_one_lead_uidx
  on cinema_members (cinema_id) where is_lead;

-- ---------------------------------------------------------
-- 1-3) cinema_contact_logs : 연락 이력
-- ---------------------------------------------------------
create table if not exists cinema_contact_logs (
  id                  bigint generated always as identity primary key,
  cinema_id           bigint      not null references cinemas(id) on delete cascade,
  member_id           bigint      references members(id) on delete set null,
  contacted_at        timestamptz not null default now(),
  contact_method      varchar(30) not null,
  contact_person      varchar(80),
  result              varchar(50),
  note                text        not null check (length(trim(note)) > 0),
  next_follow_up_date date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists cinema_contact_logs_cinema_id_idx    on cinema_contact_logs (cinema_id);
create index if not exists cinema_contact_logs_contacted_at_idx on cinema_contact_logs (contacted_at desc);
create index if not exists cinema_contact_logs_followup_idx     on cinema_contact_logs (next_follow_up_date);

-- ---------------------------------------------------------
-- 1-4) cinema_screening_dates : 후보/가능/불가/확정 일정
-- ---------------------------------------------------------
create table if not exists cinema_screening_dates (
  id             bigint generated always as identity primary key,
  cinema_id      bigint      not null references cinemas(id) on delete cascade,
  date_type      varchar(20) not null,
  screening_date date        not null,
  start_time     time,
  end_time       time,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (start_time is null or end_time is null or end_time > start_time),
  unique (cinema_id, screening_date, date_type)
);
create index if not exists cinema_screening_dates_cinema_id_idx on cinema_screening_dates (cinema_id);
create index if not exists cinema_screening_dates_date_idx      on cinema_screening_dates (screening_date);

-- ---------------------------------------------------------
-- 1-5) cinema_links : 외부 링크 (Storage 미사용)
-- ---------------------------------------------------------
create table if not exists cinema_links (
  id            bigint generated always as identity primary key,
  cinema_id     bigint      not null references cinemas(id) on delete cascade,
  link_type     varchar(30) not null,
  label         varchar(80) not null,
  url           text        not null check (length(trim(url)) > 0 and url ~* '^https?://'),
  display_order integer     not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists cinema_links_cinema_id_idx on cinema_links (cinema_id);

-- =========================================================
-- 2) RLS + 권한 (로그인 없음 → 5개 테이블 모두 anon CRUD)
-- =========================================================
alter table cinemas                enable row level security;
alter table cinema_members         enable row level security;
alter table cinema_contact_logs    enable row level security;
alter table cinema_screening_dates enable row level security;
alter table cinema_links           enable row level security;

grant usage on schema public to anon;
grant select, insert, update, delete on cinemas                to anon;
grant select, insert, update, delete on cinema_members         to anon;
grant select, insert, update, delete on cinema_contact_logs    to anon;
grant select, insert, update, delete on cinema_screening_dates to anon;
grant select, insert, update, delete on cinema_links           to anon;

-- 정책 생성 헬퍼: 테이블마다 select/insert/update/delete (재실행 위해 DROP 먼저)
do $$
declare t text;
begin
  foreach t in array array['cinemas','cinema_members','cinema_contact_logs','cinema_screening_dates','cinema_links']
  loop
    execute format('drop policy if exists %I_anon_select on %I', t, t);
    execute format('create policy %I_anon_select on %I for select to anon using (true)', t, t);
    execute format('drop policy if exists %I_anon_insert on %I', t, t);
    execute format('create policy %I_anon_insert on %I for insert to anon with check (true)', t, t);
    execute format('drop policy if exists %I_anon_update on %I', t, t);
    execute format('create policy %I_anon_update on %I for update to anon using (true) with check (true)', t, t);
    execute format('drop policy if exists %I_anon_delete on %I', t, t);
    execute format('create policy %I_anon_delete on %I for delete to anon using (true)', t, t);
  end loop;
end $$;

-- =========================================================
-- 3) 확인용 SQL (필요할 때 주석 해제)
-- =========================================================
-- select * from cinemas order by updated_at desc;                                   -- (1) 전체
-- select c.name, m.name author, cm.is_lead from cinemas c                            -- (2) 담당자
--   join cinema_members cm on cm.cinema_id=c.id join members m on m.id=cm.member_id
--   order by c.updated_at desc, cm.display_order;
-- select c.name, l.* from cinemas c join cinema_contact_logs l on l.cinema_id=c.id   -- (3) 연락기록
--   order by l.contacted_at desc;
-- select c.name, d.* from cinemas c join cinema_screening_dates d on d.cinema_id=c.id -- (4) 일정
--   order by d.screening_date asc;
-- select c.name, k.* from cinemas c join cinema_links k on k.cinema_id=c.id           -- (5) 링크
--   order by k.display_order asc;
-- select status, count(*) from cinemas group by status;                              -- (6) 상태별
-- select region, count(*) from cinemas group by region;                              -- (7) 지역별
-- select c.name, l.next_follow_up_date from cinemas c                                -- (8) 지난 후속연락
--   join cinema_contact_logs l on l.cinema_id=c.id where l.next_follow_up_date < current_date;
-- select distinct c.* from cinemas c join cinema_screening_dates d on d.cinema_id=c.id -- (9) 확정일 있는 장소
--   where d.date_type='confirmed';
-- select c.* from cinemas c where not exists                                          -- (10) 담당자 없는 장소
--   (select 1 from cinema_members cm where cm.cinema_id=c.id);
-- select c.* from cinemas c where not exists                                          -- (11) 링크 없는 장소
--   (select 1 from cinema_links k where k.cinema_id=c.id);
