-- =========================================================
-- 회계 관계형 스키마 (bigact/jsonb → 관계형 테이블 전환)
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 구조: accounting_categories 1:N accounting_accounts 1:N accounting_entries
--       + accounting_settings(총 버짓 별도 관리)
-- 안전: 기존 members·timesheets·bigact 는 전혀 건드리지 않음. 여러 번 실행해도 안전.
--
-- ⚠️ 보안 한계(로그인 없음): 이 앱은 인증이 없고 브라우저의 anon 역할로 접근합니다.
--    따라서 "앱 주소 + Supabase anon key" 를 아는 사람은 누구나 회계 거래(entries)와
--    총 버짓(settings)을 조회·수정·삭제할 수 있습니다. 분류/계정과목(categories·accounts)
--    은 anon 에게 읽기 전용이라 앱에서 바뀌지 않지만, entries·settings 는 공개 쓰기입니다.
--    민감 데이터라면 이후 Supabase Auth 도입 + 역할 기반 RLS 로 강화해야 합니다.
-- =========================================================

-- ---------------------------------------------------------
-- 1-1) accounting_categories : 큰 분류 (수입/지출 × 분류명)
--      화면엔 '수입'/'지출'을 보여주되 DB엔 안정 코드 income/expense 저장
-- ---------------------------------------------------------
create table if not exists accounting_categories (
  id            bigint generated always as identity primary key,
  entry_type    varchar(10) not null check (entry_type in ('income', 'expense')),
  name          varchar(50) not null,
  color         varchar(20),
  display_order integer     not null default 0,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  unique (entry_type, name)
);

-- ---------------------------------------------------------
-- 1-2) accounting_accounts : 분류 아래 계정과목
-- ---------------------------------------------------------
create table if not exists accounting_accounts (
  id            bigint generated always as identity primary key,
  category_id   bigint      not null
                  references accounting_categories(id) on delete restrict,
  name          varchar(70) not null,
  display_order integer     not null default 0,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  unique (category_id, name)
);

-- ---------------------------------------------------------
-- 1-3) accounting_entries : 실제 수입/지출 거래
--      amount 는 DB 생성 컬럼(수량×횟수×단가). 수입·지출 모두 양수로 저장하고
--      부호는 account→category→entry_type 관계로 판단(음수 금액 미사용).
-- ---------------------------------------------------------
create table if not exists accounting_entries (
  id               bigint generated always as identity primary key,
  account_id       bigint       not null
                     references accounting_accounts(id) on delete restrict,
  transaction_date date         not null default current_date,
  content          text         not null,
  quantity         numeric(10,2) not null default 1 check (quantity > 0),
  occurrence_count numeric(10,2) not null default 1 check (occurrence_count > 0),
  unit_price       numeric(14,2) not null default 0 check (unit_price >= 0),
  amount           numeric(16,2) generated always as (quantity * occurrence_count * unit_price) stored,
  legacy_id        text,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

-- 조회 성능 + 중복 이관 방지 인덱스
create index        if not exists accounting_entries_account_id_idx on accounting_entries (account_id);
create index        if not exists accounting_entries_date_idx       on accounting_entries (transaction_date desc);
create unique index if not exists accounting_entries_legacy_id_uidx on accounting_entries (legacy_id); -- NULL 다수 허용

-- ---------------------------------------------------------
-- 1-4) accounting_settings : 프로젝트 전체 회계 설정 (총 버짓). 항상 1행.
-- ---------------------------------------------------------
create table if not exists accounting_settings (
  id           smallint primary key default 1 check (id = 1),
  total_budget numeric(16,2) not null default 0 check (total_budget >= 0),
  updated_at   timestamptz   not null default now()
);
insert into accounting_settings (id, total_budget) values (1, 0)
on conflict (id) do nothing;

-- =========================================================
-- 2) 초기 분류 + 계정과목 (현재 앱의 INCOME/EXPENSE_STRUCTURE·색상 그대로)
--    재실행 시 color·display_order·is_active 를 최신화
-- =========================================================
insert into accounting_categories (entry_type, name, color, display_order) values
  ('income',  '고유목적사업수익', '#31cc66', 1),
  ('income',  '수익사업',         '#00a3fe', 2),
  ('income',  '영업외수익',       '#fea501', 3),
  ('expense', '인건비',           '#fea1cd', 1),
  ('expense', '운영비',           '#00a3fe', 2),
  ('expense', '제작 및 비품',     '#ff7300', 3),
  ('expense', '기타',             '#fece00', 4),
  ('expense', '영업외비용',       '#9a8f95', 5)
on conflict (entry_type, name) do update set
  color         = excluded.color,
  display_order = excluded.display_order,
  is_active     = true;

-- 계정과목: category_id 를 (entry_type, 분류명)으로 찾아 등록
insert into accounting_accounts (category_id, name, display_order)
select c.id, v.name, v.display_order
from (values
  -- 수입 · 고유목적사업수익
  ('income',  '고유목적사업수익', '회비',              1),
  ('income',  '고유목적사업수익', '후원금',            2),
  ('income',  '고유목적사업수익', '지원금',            3),
  -- 수입 · 수익사업
  ('income',  '수익사업',         '콘텐츠 수익',       1),
  ('income',  '수익사업',         '도서판매 수익',     2),
  ('income',  '수익사업',         '수익사업-지원금',   3),
  -- 수입 · 영업외수익
  ('income',  '영업외수익',       '보증금수입',        1),
  ('income',  '영업외수익',       '이자',              2),
  ('income',  '영업외수익',       '잡이익',            3),
  ('income',  '영업외수익',       '기타수입',          4),
  -- 지출 · 인건비
  ('expense', '인건비',           '인건비',            1),
  -- 지출 · 운영비
  ('expense', '운영비',           '회의비',            1),
  ('expense', '운영비',           '여비교통비',        2),
  ('expense', '운영비',           '지급임차료',        3),
  ('expense', '운영비',           '대관',              4),
  ('expense', '운영비',           '운반, 배송',        5),
  ('expense', '운영비',           '서비스 이용료',     6),
  -- 지출 · 제작 및 비품
  ('expense', '제작 및 비품',     '제작비',            1),
  ('expense', '제작 및 비품',     '소모품비',          2),
  -- 지출 · 기타
  ('expense', '기타',             '세금과공과금',      1),
  ('expense', '기타',             '지급수수료',        2),
  ('expense', '기타',             '판매수수료',        3),
  ('expense', '기타',             '기타',              4),
  -- 지출 · 영업외비용
  ('expense', '영업외비용',       '잡손실',            1)
) as v(entry_type, category_name, name, display_order)
join accounting_categories c
  on c.entry_type = v.entry_type and c.name = v.category_name
on conflict (category_id, name) do update set
  display_order = excluded.display_order,
  is_active     = true;

-- =========================================================
-- 3) RLS + 권한 (로그인 없음 → anon 기준)
--    categories/accounts: 읽기 전용 · entries: CRUD · settings: 읽기+수정
-- =========================================================
alter table accounting_categories enable row level security;
alter table accounting_accounts   enable row level security;
alter table accounting_entries    enable row level security;
alter table accounting_settings   enable row level security;

grant usage on schema public to anon;
grant select                         on accounting_categories to anon;
grant select                         on accounting_accounts   to anon;
grant select, insert, update, delete on accounting_entries    to anon;
grant select, update                 on accounting_settings   to anon;

-- categories: 조회만
drop policy if exists accounting_categories_anon_select on accounting_categories;
create policy accounting_categories_anon_select on accounting_categories
  for select to anon using (true);

-- accounts: 조회만
drop policy if exists accounting_accounts_anon_select on accounting_accounts;
create policy accounting_accounts_anon_select on accounting_accounts
  for select to anon using (true);

-- entries: CRUD
drop policy if exists accounting_entries_anon_select on accounting_entries;
create policy accounting_entries_anon_select on accounting_entries
  for select to anon using (true);

drop policy if exists accounting_entries_anon_insert on accounting_entries;
create policy accounting_entries_anon_insert on accounting_entries
  for insert to anon with check (true);

drop policy if exists accounting_entries_anon_update on accounting_entries;
create policy accounting_entries_anon_update on accounting_entries
  for update to anon using (true) with check (true);

drop policy if exists accounting_entries_anon_delete on accounting_entries;
create policy accounting_entries_anon_delete on accounting_entries
  for delete to anon using (true);

-- settings: 조회 + 수정
drop policy if exists accounting_settings_anon_select on accounting_settings;
create policy accounting_settings_anon_select on accounting_settings
  for select to anon using (true);

drop policy if exists accounting_settings_anon_update on accounting_settings;
create policy accounting_settings_anon_update on accounting_settings
  for update to anon using (true) with check (true);

-- =========================================================
-- 4) 확인용 SQL (필요할 때 주석 해제 후 실행)
-- =========================================================
-- -- (1) 전체 분류
-- select entry_type, name, color, display_order
-- from accounting_categories order by entry_type, display_order;
--
-- -- (2) 분류 + 계정과목 JOIN
-- select c.entry_type, c.name as category, a.id as account_id, a.name as account, a.display_order
-- from accounting_accounts a
-- join accounting_categories c on c.id = a.category_id
-- order by c.entry_type, c.display_order, a.display_order;
--
-- -- (3) 회계 내역 전체 JOIN
-- select e.id, e.transaction_date, c.entry_type, c.name as category, a.name as account,
--        e.content, e.quantity, e.occurrence_count, e.unit_price, e.amount, e.created_at, e.updated_at
-- from accounting_entries e
-- join accounting_accounts a   on a.id = e.account_id
-- join accounting_categories c on c.id = a.category_id
-- order by e.transaction_date desc, e.created_at desc;
--
-- -- (4) 수입 합계
-- select coalesce(sum(e.amount),0) as total_income
-- from accounting_entries e
-- join accounting_accounts a   on a.id = e.account_id
-- join accounting_categories c on c.id = a.category_id
-- where c.entry_type = 'income';
--
-- -- (5) 지출 합계
-- select coalesce(sum(e.amount),0) as total_expense
-- from accounting_entries e
-- join accounting_accounts a   on a.id = e.account_id
-- join accounting_categories c on c.id = a.category_id
-- where c.entry_type = 'expense';
--
-- -- (6) 총 버짓
-- select total_budget from accounting_settings where id = 1;
--
-- -- (7) 계산 결과 (잔액 규칙 = 앱과 동일: budget - expense + income)
-- with s as (select total_budget from accounting_settings where id = 1),
--      i as (select coalesce(sum(e.amount),0) inc from accounting_entries e
--            join accounting_accounts a on a.id=e.account_id
--            join accounting_categories c on c.id=a.category_id where c.entry_type='income'),
--      x as (select coalesce(sum(e.amount),0) exp from accounting_entries e
--            join accounting_accounts a on a.id=e.account_id
--            join accounting_categories c on c.id=a.category_id where c.entry_type='expense')
-- select s.total_budget, i.inc as total_income, x.exp as total_expense,
--        (s.total_budget - x.exp + i.inc) as balance
-- from s, i, x;
