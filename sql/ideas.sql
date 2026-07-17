-- =========================================================
-- 아이디어·메모 관계형 스키마 (bigact/jsonb → 관계형 테이블 전환)
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 구조: ideas 1:N idea_comments,  ideas N:M members (idea_members 경유)
-- 안전: 기존 members·timesheets·accounting_*·bigact 는 건드리지 않음. 재실행 안전.
-- 이미지: 이번 버전은 Supabase Storage 를 쓰지 않고 이미지 컬럼도 두지 않음(URL만 유지).
--
-- ⚠️ 보안 한계(로그인 없음): anon 역할로 접근하므로 DB는 실제 작성자를 인증하지 못합니다.
--    앱에서 고른 member_id 를 '표시용 작성자'로 저장할 뿐이며, 앱 주소 + anon key 를
--    아는 사람은 아이디어·댓글을 등록·수정·삭제할 수 있습니다. 카테고리 표시색 등은
--    화면 설정이고, 민감 데이터면 이후 Supabase Auth + 역할 기반 RLS 로 강화해야 합니다.
-- =========================================================

-- ---------------------------------------------------------
-- 1-1) ideas : 포스트잇 본문 (title/likes/pinned/image 없음)
-- ---------------------------------------------------------
create table if not exists ideas (
  id         bigint generated always as identity primary key,
  category   varchar(50) not null,
  content    text        not null check (length(trim(content)) > 0),
  link_url   text        check (link_url is null or link_url ~* '^https?://'),
  legacy_id  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ideas_legacy_id_uidx on ideas (legacy_id); -- NULL 다수 허용
create index        if not exists ideas_category_idx    on ideas (category);
create index        if not exists ideas_created_at_idx   on ideas (created_at desc);

-- ---------------------------------------------------------
-- 1-2) idea_members : 아이디어 ↔ 작성자/참여자 (N:M)
-- ---------------------------------------------------------
create table if not exists idea_members (
  idea_id       bigint  not null references ideas(id)   on delete cascade,  -- 아이디어 삭제 시 연결도 삭제
  member_id     bigint  not null references members(id) on delete restrict, -- 연결된 팀원은 삭제 제한
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (idea_id, member_id)   -- 같은 아이디어에 같은 팀원 중복 태그 방지
);
create index if not exists idea_members_member_id_idx on idea_members (member_id);

-- ---------------------------------------------------------
-- 1-3) idea_comments : 아이디어 댓글 (1:N)
-- ---------------------------------------------------------
create table if not exists idea_comments (
  id         bigint generated always as identity primary key,
  idea_id    bigint not null references ideas(id)   on delete cascade,   -- 아이디어 삭제 시 댓글도 삭제
  member_id  bigint not null references members(id) on delete restrict,  -- 댓글 있는 팀원은 삭제 제한
  content    text   not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idea_comments_idea_id_idx    on idea_comments (idea_id);
create index if not exists idea_comments_created_at_idx on idea_comments (created_at);

-- =========================================================
-- 2) RLS + 권한 (로그인 없음 → 세 테이블 모두 anon CRUD)
-- =========================================================
alter table ideas         enable row level security;
alter table idea_members  enable row level security;
alter table idea_comments enable row level security;

grant usage on schema public to anon;
grant select, insert, update, delete on ideas         to anon;
grant select, insert, update, delete on idea_members  to anon;
grant select, insert, update, delete on idea_comments to anon;

-- ideas
drop policy if exists ideas_anon_select on ideas;
create policy ideas_anon_select on ideas for select to anon using (true);
drop policy if exists ideas_anon_insert on ideas;
create policy ideas_anon_insert on ideas for insert to anon with check (true);
drop policy if exists ideas_anon_update on ideas;
create policy ideas_anon_update on ideas for update to anon using (true) with check (true);
drop policy if exists ideas_anon_delete on ideas;
create policy ideas_anon_delete on ideas for delete to anon using (true);

-- idea_members
drop policy if exists idea_members_anon_select on idea_members;
create policy idea_members_anon_select on idea_members for select to anon using (true);
drop policy if exists idea_members_anon_insert on idea_members;
create policy idea_members_anon_insert on idea_members for insert to anon with check (true);
drop policy if exists idea_members_anon_update on idea_members;
create policy idea_members_anon_update on idea_members for update to anon using (true) with check (true);
drop policy if exists idea_members_anon_delete on idea_members;
create policy idea_members_anon_delete on idea_members for delete to anon using (true);

-- idea_comments
drop policy if exists idea_comments_anon_select on idea_comments;
create policy idea_comments_anon_select on idea_comments for select to anon using (true);
drop policy if exists idea_comments_anon_insert on idea_comments;
create policy idea_comments_anon_insert on idea_comments for insert to anon with check (true);
drop policy if exists idea_comments_anon_update on idea_comments;
create policy idea_comments_anon_update on idea_comments for update to anon using (true) with check (true);
drop policy if exists idea_comments_anon_delete on idea_comments;
create policy idea_comments_anon_delete on idea_comments for delete to anon using (true);

-- =========================================================
-- 3) 확인용 SQL (필요할 때 주석 해제 후 실행)
-- =========================================================
-- -- (1) 아이디어 목록
-- select id, category, content, link_url, created_at from ideas order by created_at desc;
--
-- -- (2) 아이디어 + 작성자 JOIN
-- select i.id, i.category, i.content, m.name as author, im.display_order
-- from ideas i
-- join idea_members im on im.idea_id = i.id
-- join members m       on m.id = im.member_id
-- order by i.created_at desc, im.display_order asc;
--
-- -- (3) 아이디어 + 댓글 JOIN
-- select i.id as idea_id, i.content as idea, c.id as comment_id, c.content as comment, c.created_at
-- from ideas i
-- join idea_comments c on c.idea_id = i.id
-- order by i.created_at desc, c.created_at asc;
--
-- -- (4) 아이디어별 댓글 개수
-- select i.id, i.content, count(c.id) as comment_count
-- from ideas i left join idea_comments c on c.idea_id = i.id
-- group by i.id, i.content order by i.created_at desc;
--
-- -- (5) URL 있는 아이디어만
-- select id, category, content, link_url from ideas where link_url is not null;
--
-- -- (6) 작성자 없이 저장된 아이디어
-- select i.id, i.category, i.content from ideas i
-- where not exists (select 1 from idea_members im where im.idea_id = i.id);
--
-- -- (7) 댓글 작성자 + 내용
-- select c.id, i.content as idea, m.name as comment_author, c.content as comment, c.created_at
-- from idea_comments c
-- join ideas i   on i.id = c.idea_id
-- join members m on m.id = c.member_id
-- order by c.created_at asc;
