-- =========================================================
-- 회의록 관계형 스키마 (bigact/jsonb → 관계형 테이블 전환)
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 구조: meeting_minutes 1:N meeting_minute_members N:1 members
--       외부 게스트는 이름만 기록 → meeting_minutes.guest_names TEXT[]
-- 안전: 기존 members·timesheets·accounting_*·ideas·cinemas·bigact 는 건드리지 않음. 재실행 안전.
--
-- ⚠️ 보안 한계(로그인 없음): anon 역할로 접근하므로 실제 참석자/작성자를 인증하지 못합니다.
--    화면에서 고른 member_id 를 참석자로 저장할 뿐이며, 앱 주소 + anon key 를 아는 사람은
--    회의록을 등록·수정·삭제할 수 있습니다.
-- =========================================================

-- ---------------------------------------------------------
-- 1-1) meeting_minutes : 회의록 본문
-- ---------------------------------------------------------
create table if not exists meeting_minutes (
  id                bigint generated always as identity primary key,
  title             varchar(150) not null check (length(trim(title)) > 0),
  meeting_date      date         not null default current_date,
  purpose           text,
  content           text,
  next_agenda       text,
  next_meeting_date date,
  guest_names       text[]       not null default '{}',
  legacy_id         text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);
create unique index if not exists meeting_minutes_legacy_id_uidx on meeting_minutes (legacy_id); -- NULL 다수 허용
create index if not exists meeting_minutes_date_idx      on meeting_minutes (meeting_date desc);
create index if not exists meeting_minutes_next_date_idx on meeting_minutes (next_meeting_date);
create index if not exists meeting_minutes_updated_idx   on meeting_minutes (updated_at desc);

-- ---------------------------------------------------------
-- 1-2) meeting_minute_members : 회의 ↔ 참석 팀원 (N:M)
-- ---------------------------------------------------------
create table if not exists meeting_minute_members (
  meeting_minute_id bigint  not null references meeting_minutes(id) on delete cascade,
  member_id         bigint  not null references members(id)        on delete restrict,
  display_order     integer not null default 0,
  created_at        timestamptz not null default now(),
  primary key (meeting_minute_id, member_id)
);
create index if not exists meeting_minute_members_member_id_idx on meeting_minute_members (member_id);

-- =========================================================
-- 2) RLS + 권한 (로그인 없음 → 두 테이블 anon CRUD)
-- =========================================================
alter table meeting_minutes        enable row level security;
alter table meeting_minute_members enable row level security;

grant usage on schema public to anon;
grant select, insert, update, delete on meeting_minutes        to anon;
grant select, insert, update, delete on meeting_minute_members to anon;

do $$
declare t text;
begin
  foreach t in array array['meeting_minutes','meeting_minute_members']
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
-- select id, title, meeting_date, next_meeting_date, guest_names from meeting_minutes order by meeting_date desc;   -- (1)
-- select mm.title, m.name as member, p.display_order                                                               -- (2) 참석자 JOIN
--   from meeting_minutes mm
--   join meeting_minute_members p on p.meeting_minute_id = mm.id
--   join members m on m.id = p.member_id
--   order by mm.meeting_date desc, p.display_order asc;
-- select mm.id, mm.title, count(p.member_id) as attendees                                                          -- (3) 참석 인원 수
--   from meeting_minutes mm left join meeting_minute_members p on p.meeting_minute_id = mm.id
--   group by mm.id, mm.title order by mm.meeting_date desc;
-- select id, title, next_meeting_date from meeting_minutes where next_meeting_date is not null;                    -- (4) 다음 미팅 있는
-- select mm.id, mm.title from meeting_minutes mm                                                                   -- (5) 참석자 없는
--   where not exists (select 1 from meeting_minute_members p where p.meeting_minute_id = mm.id);
-- select id, title, guest_names from meeting_minutes where array_length(guest_names,1) > 0;                        -- (6) 게스트 있는
