-- =========================================================
-- cinemas 에 '좋아요'·'상단 고정' 컬럼 추가 (기존 프로젝트용, 1회 실행)
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 안전: 기존 데이터·다른 테이블 영향 없음. 재실행 안전(IF NOT EXISTS).
--   · is_pinned : 목록 상단 고정
--   · liked_by  : 좋아요 누른 '기기 id' 목록(로그인 없음 → 사람이 아니라 기기 단위)
-- 권한: cinemas 는 이미 anon UPDATE 정책이 있어 추가 정책 불필요.
-- =========================================================
alter table cinemas add column if not exists is_pinned boolean not null default false;
alter table cinemas add column if not exists liked_by  text[]  not null default '{}';
create index if not exists cinemas_is_pinned_idx on cinemas (is_pinned);

-- 확인:
-- select id, name, is_pinned, liked_by from cinemas order by is_pinned desc limit 10;
