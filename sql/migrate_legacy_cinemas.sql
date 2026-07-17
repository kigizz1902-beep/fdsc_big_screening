-- =========================================================
-- 기존 영화관(bigact kind='cinema') → 관계형 테이블 1회 이관
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 전제:  sql/cinemas.sql 로 5개 테이블이 생성돼 있어야 함
-- 안전:  bigact 는 SELECT 만(원본 삭제·수정 없음). legacy_id UNIQUE + ON CONFLICT 로
--        여러 번 실행해도 중복 이관되지 않음.
--
-- 기존 필드(실측): { id, name, region, location, status, scale, manager(단일),
--                    contact(전화), site(URL), fee(자유텍스트), method, dates[], memo }
-- 매핑 결정:
--   name→name, region→region, location→address, contact→primary_contact_phone,
--   status: 확인중→researching / 컨택완료→contacted / 상영일정→booked
--   scale·fee(자유텍스트)·method 는 숫자 컬럼에 매핑 불가 → notes 에 원문 보존
--   (rental_cost·capacity·district 는 NULL. 신규 등록부터 숫자로 입력)
--   manager→cinema_members(is_lead), site→cinema_links(website),
--   dates→cinema_screening_dates(상영일정이면 confirmed, 아니면 candidate)
-- =========================================================

-- ---------------------------------------------------------
-- 1) cinemas 이관
-- ---------------------------------------------------------
insert into cinemas (name, region, address, status, primary_contact_phone, notes, legacy_id, created_at, updated_at)
select
  b.data->>'name',
  nullif(b.data->>'region',''),
  nullif(b.data->>'location',''),
  case b.data->>'status'
    when '확인중' then 'researching'
    when '컨택완료' then 'contacted'
    when '상영일정' then 'booked'
    else 'researching'
  end,
  nullif(b.data->>'contact',''),
  -- memo + (규모·대관비 원문·대관방법) 보존
  nullif(btrim(concat_ws(E'\n',
    nullif(b.data->>'memo',''),
    case when nullif(b.data->>'scale','')  is not null then '규모: '        || (b.data->>'scale')  end,
    case when nullif(b.data->>'fee','')    is not null then '대관비(원문): ' || (b.data->>'fee')    end,
    case when nullif(b.data->>'method','') is not null then '대관방법: '     || (b.data->>'method') end
  )), ''),
  b.id,
  coalesce(b.updated_at, now()),
  coalesce(b.updated_at, now())
from bigact b
where b.kind = 'cinema'
  and length(trim(coalesce(b.data->>'name',''))) > 0
on conflict (legacy_id) do nothing;

-- ---------------------------------------------------------
-- 2) 담당자(manager 단일) → cinema_members (is_lead=true)
-- ---------------------------------------------------------
insert into cinema_members (cinema_id, member_id, is_lead, display_order)
select c.id, m.id, true, 0
from bigact b
join cinemas c on c.legacy_id = b.id
join members m
  on m.name = case btrim(b.data->>'manager')
       when '도은' then '김도은' when '가현' then '오가현' when '상아' then '성솔푸른'
       when '추가인원' then '성솔푸른' when 'FDSC' then '성솔푸른' when '윤서' then '송윤서'
       when '서린' then '채서린' when '설향' then '정설향' else btrim(b.data->>'manager')
     end
where b.kind = 'cinema' and coalesce(btrim(b.data->>'manager'),'') <> ''
on conflict (cinema_id, member_id) do nothing;

-- ---------------------------------------------------------
-- 3) 상영 날짜 배열 → cinema_screening_dates
-- ---------------------------------------------------------
insert into cinema_screening_dates (cinema_id, date_type, screening_date)
select c.id,
       case when b.data->>'status' = '상영일정' then 'confirmed' else 'candidate' end,
       (d.value)::date
from bigact b
join cinemas c on c.legacy_id = b.id
cross join lateral jsonb_array_elements_text(coalesce(b.data->'dates', '[]'::jsonb)) as d(value)
where b.kind = 'cinema' and d.value ~ '^\d{4}-\d{2}-\d{2}$'
on conflict (cinema_id, screening_date, date_type) do nothing;

-- ---------------------------------------------------------
-- 4) 홈페이지 URL → cinema_links (website). 프로토콜 없으면 https:// 부여.
--    링크는 UNIQUE 제약이 없어 NOT EXISTS 로 재실행 중복 방지.
-- ---------------------------------------------------------
insert into cinema_links (cinema_id, link_type, label, url, display_order)
select c.id, 'website', '홈페이지',
       case when b.data->>'site' ~* '^https?://' then b.data->>'site' else 'https://' || (b.data->>'site') end,
       0
from bigact b
join cinemas c on c.legacy_id = b.id
where b.kind = 'cinema' and coalesce(btrim(b.data->>'site'),'') <> ''
  and not exists (
    select 1 from cinema_links k
    where k.cinema_id = c.id
      and k.url = case when b.data->>'site' ~* '^https?://' then b.data->>'site' else 'https://' || (b.data->>'site') end
  );

-- =========================================================
-- 5) 확인용 SQL (필요할 때 주석 해제)
-- =========================================================
-- select (select count(*) from bigact where kind='cinema')          as legacy_count,   -- 기존 vs 이관
--        (select count(*) from cinemas where legacy_id is not null)  as migrated_count;
-- select count(*) as member_links from cinema_members;                                 -- 담당자 연결
-- select count(*) as dates_migrated from cinema_screening_dates;                       -- 일정
-- select count(*) as links_migrated from cinema_links;                                 -- 링크
-- -- 담당자 이름이 members 와 매칭 안 된 기존 장소
-- select b.id, b.data->>'name' name, b.data->>'manager' manager from bigact b
-- where b.kind='cinema' and coalesce(btrim(b.data->>'manager'),'')<>''
--   and not exists (select 1 from members m where m.name = case btrim(b.data->>'manager')
--     when '도은' then '김도은' when '가현' then '오가현' when '상아' then '성솔푸른'
--     when '추가인원' then '성솔푸른' when 'FDSC' then '성솔푸른' when '윤서' then '송윤서'
--     when '서린' then '채서린' when '설향' then '정설향' else btrim(b.data->>'manager') end);
-- -- 상태 코드로 변환되지 못한(예상 밖) 기존 상태값
-- select distinct b.data->>'status' as legacy_status from bigact b
-- where b.kind='cinema' and b.data->>'status' not in ('확인중','컨택완료','상영일정');
-- -- 이름 누락 등 주요 필드 결측 장소
-- select b.id, b.data from bigact b where b.kind='cinema' and coalesce(trim(b.data->>'name'),'')='';
-- -- 참고: fee(대관비)는 자유텍스트라 rental_cost(숫자)로 이관하지 않고 notes 에 원문 보존함.
-- select id, name, notes from cinemas where legacy_id is not null and notes ilike '%대관비(원문)%';
