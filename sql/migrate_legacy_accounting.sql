-- =========================================================
-- 기존 회계(bigact kind='acc' + __settings__.budget) → 관계형 테이블 1회 이관
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 전제:  sql/accounting.sql 로 4개 테이블 + 분류/계정과목이 이미 생성돼 있어야 함
-- 안전:  bigact 는 오직 SELECT 만 함(원본 삭제·수정 없음).
--        legacy_id UNIQUE + ON CONFLICT 로 여러 번 실행해도 중복 이관되지 않음.
--
-- 기존 필드(실측): { id, type:'수입'|'지출', group, account, content,
--                    qty, times, unit, amount, date }  (amount = qty*times*unit)
-- 총 버짓: bigact __settings__ 행의 data->>'budget'
-- =========================================================

-- ---------------------------------------------------------
-- 1) 거래 이관: bigact(kind='acc') → accounting_entries
--    account_id 는 (entry_type + 분류명 + 계정과목명) JOIN 으로 정확히 결정
--    amount 는 생성 컬럼이므로 INSERT 하지 않음(수량×횟수×단가 자동 계산)
-- ---------------------------------------------------------
insert into accounting_entries
  (account_id, transaction_date, content, quantity, occurrence_count, unit_price, created_at, updated_at, legacy_id)
select
  a.id,
  (b.data->>'date')::date,
  coalesce(b.data->>'content', ''),
  (b.data->>'qty')::numeric,
  (b.data->>'times')::numeric,
  (b.data->>'unit')::numeric,
  coalesce(b.updated_at, now()),
  coalesce(b.updated_at, now()),
  b.id
from bigact b
join accounting_categories c
  on c.entry_type = case b.data->>'type' when '수입' then 'income' when '지출' then 'expense' end
 and c.name = b.data->>'group'
join accounting_accounts a
  on a.category_id = c.id
 and a.name = b.data->>'account'
where b.kind = 'acc'
  and b.data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'
  and (b.data->>'qty')   ~ '^[0-9]+(\.[0-9]+)?$' and (b.data->>'qty')::numeric   > 0
  and (b.data->>'times') ~ '^[0-9]+(\.[0-9]+)?$' and (b.data->>'times')::numeric > 0
  and (b.data->>'unit')  ~ '^[0-9]+(\.[0-9]+)?$' and (b.data->>'unit')::numeric  >= 0
on conflict (legacy_id) do nothing;

-- ---------------------------------------------------------
-- 2) 총 버짓 이관: bigact __settings__.budget → accounting_settings.id=1
--    (기존 값이 있을 때만 반영. 없으면 그대로 둠)
-- ---------------------------------------------------------
update accounting_settings s
set total_budget = (b.data->>'budget')::numeric,
    updated_at   = now()
from bigact b
where s.id = 1
  and b.id = '__settings__'
  and b.data ? 'budget'
  and (b.data->>'budget') ~ '^[0-9]+(\.[0-9]+)?$';

-- =========================================================
-- 3) 확인용 SQL (필요할 때 주석 해제 후 실행)
-- =========================================================
-- -- (a) 기존 회계 거래 개수
-- select count(*) as legacy_acc_count from bigact where kind = 'acc';
--
-- -- (b) 새 accounting_entries 중 이관된(legacy_id 있는) 개수
-- select count(*) as migrated_count from accounting_entries where legacy_id is not null;
--
-- -- (c) 이관되지 않은(분류/계정과목 미매칭) 기존 거래 진단
-- select b.id, b.data->>'type' as type, b.data->>'group' as category,
--        b.data->>'account' as account, b.data->>'date' as date
-- from bigact b
-- where b.kind = 'acc'
--   and not exists (
--     select 1
--     from accounting_categories c
--     join accounting_accounts a on a.category_id = c.id
--     where c.entry_type = case b.data->>'type' when '수입' then 'income' when '지출' then 'expense' end
--       and c.name = b.data->>'group'
--       and a.name = b.data->>'account'
--   );
--
-- -- (d) 기존 amount 와 새 계산 금액(수량×횟수×단가)이 다른 기록 (있으면 이관 전 사용자 보고)
-- select b.id, (b.data->>'amount')::numeric as legacy_amount,
--        (b.data->>'qty')::numeric * (b.data->>'times')::numeric * (b.data->>'unit')::numeric as calc_amount
-- from bigact b
-- where b.kind = 'acc'
--   and (b.data->>'amount')::numeric
--       <> (b.data->>'qty')::numeric * (b.data->>'times')::numeric * (b.data->>'unit')::numeric;
--
-- -- (e) 기존 총 버짓 vs 새 총 버짓
-- select (select (data->>'budget')::numeric from bigact where id='__settings__') as legacy_budget,
--        (select total_budget from accounting_settings where id = 1)            as new_budget;
