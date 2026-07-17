-- =========================================================
-- 기존 아이디어(bigact kind='idea') → 관계형 테이블 1회 이관
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 전제:  sql/ideas.sql 로 ideas·idea_members·idea_comments 가 생성돼 있어야 함
-- 안전:  bigact 는 SELECT 만(원본 삭제·수정 없음). legacy_id UNIQUE + ON CONFLICT 로
--        여러 번 실행해도 중복 이관되지 않음.
--
-- 기존 필드(실측): { id, title, content, type, author(단일 문자열),
--                    image('' | 외부URL | data:base64), likes, likedBy, pinned }
-- 매핑 결정:
--   type            → ideas.category
--   title + content → ideas.content  (새 스키마엔 title 없음 → 첫 줄=title 로 병합, 손실 방지)
--   image(외부 URL)  → ideas.link_url (http(s) 없으면 https:// 부여, data:base64 는 미이관)
--   author          → idea_members (이름→members.id, 짧은 이름 보정)
--   likes/pinned    → 이관 안 함(새 모델에 없음). bigact 원본에 그대로 보존.
--   updated_at      → created_at, updated_at (없으면 now())
-- =========================================================

-- ---------------------------------------------------------
-- 1) ideas 이관
-- ---------------------------------------------------------
insert into ideas (category, content, link_url, legacy_id, created_at, updated_at)
select
  b.data->>'type',
  -- title 을 첫 줄로, content 가 있으면 이어 붙임 (양끝 공백 정리)
  btrim(
    coalesce(b.data->>'title','')
    || case when coalesce(btrim(b.data->>'content'),'') <> '' then E'\n' || (b.data->>'content') else '' end
  ),
  -- image 필드에 들어있던 '외부 URL' 만 link_url 로 (data:base64 · 빈값 → NULL)
  case
    when coalesce(b.data->>'image','') = ''       then null
    when b.data->>'image' like 'data:%'           then null
    when b.data->>'image' ~* '^https?://'          then b.data->>'image'
    else 'https://' || (b.data->>'image')
  end,
  b.id,
  coalesce(b.updated_at, now()),
  coalesce(b.updated_at, now())
from bigact b
where b.kind = 'idea'
  and length(btrim(coalesce(b.data->>'title','') || coalesce(b.data->>'content',''))) > 0  -- content CHECK 통과 보장
  and b.data->>'type' is not null
on conflict (legacy_id) do nothing;

-- ---------------------------------------------------------
-- 2) 작성자 이관: author(단일 문자열) → idea_members
--    짧은 이름/별칭 → members.name 보정 후 JOIN
-- ---------------------------------------------------------
insert into idea_members (idea_id, member_id, display_order)
select i.id, m.id, 0
from bigact b
join ideas i on i.legacy_id = b.id
join members m
  on m.name = case btrim(b.data->>'author')
       when '도은' then '김도은'
       when '가현' then '오가현'
       when '상아' then '성솔푸른'
       when '추가인원' then '성솔푸른'
       when 'FDSC' then '성솔푸른'
       when '윤서' then '송윤서'
       when '서린' then '채서린'
       when '설향' then '정설향'
       else btrim(b.data->>'author')
     end
where b.kind = 'idea'
  and coalesce(btrim(b.data->>'author'), '') <> ''
on conflict (idea_id, member_id) do nothing;

-- =========================================================
-- 3) 확인용 SQL (필요할 때 주석 해제 후 실행)
-- =========================================================
-- -- (a) 기존 아이디어 개수 vs 이관된 개수
-- select (select count(*) from bigact where kind='idea')        as legacy_idea_count,
--        (select count(*) from ideas where legacy_id is not null) as migrated_count;
--
-- -- (b) 작성자 연결 개수
-- select count(*) as author_links from idea_members;
--
-- -- (c) URL 이관 결과
-- select id, category, link_url from ideas where legacy_id is not null and link_url is not null;
--
-- -- (d) 작성자 이름이 members 와 매칭되지 않아 연결 못한 기존 아이디어
-- select b.id, b.data->>'author' as legacy_author, b.data->>'title' as title
-- from bigact b
-- where b.kind='idea' and coalesce(btrim(b.data->>'author'),'')<>''
--   and not exists (
--     select 1 from members m where m.name = case btrim(b.data->>'author')
--       when '도은' then '김도은' when '가현' then '오가현' when '상아' then '성솔푸른'
--       when '추가인원' then '성솔푸른' when 'FDSC' then '성솔푸른' when '윤서' then '송윤서'
--       when '서린' then '채서린' when '설향' then '정설향' else btrim(b.data->>'author') end);
--
-- =========================================================
-- 4) 이미지 데이터 미이관 안내 (Storage 미사용 — 이관하지 않음)
--    아래 값들은 새 관계형 구조로 옮기지 않았고, bigact 원본에 그대로 보존됩니다.
-- =========================================================
-- -- (e) 이미지 값(업로드 base64 또는 외부 URL)이 있던 기존 아이디어 "개수"
-- select count(*) as ideas_with_image_value
-- from bigact b where b.kind='idea' and coalesce(b.data->>'image','') <> '';
--
-- -- (f) 그 레코드 "목록" (base64 여부 표시) — 링크는 link_url 로 이관됨, base64 이미지는 미이관
-- select b.id, b.data->>'title' as title,
--        case when b.data->>'image' like 'data:%' then 'base64(미이관)'
--             else '외부URL→link_url 이관' end as image_kind,
--        left(b.data->>'image', 60) as image_preview
-- from bigact b
-- where b.kind='idea' and coalesce(b.data->>'image','') <> ''
-- order by b.id;
