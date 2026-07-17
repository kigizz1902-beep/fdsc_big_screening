/* =========================================================
   Supabase 클라우드 설정 (연결 정보 전용 파일)
   ---------------------------------------------------------
   · 클라우드 연결에 필요한 값은 이 파일 한 곳에서만 관리합니다.
   · index.html에서 app.js보다 "먼저" 로드되어야 합니다.
   · 두 값을 빈 문자열('')로 두면 로컬 모드(이 브라우저에만 저장)로 동작합니다.

   값 얻는 법:
   1. https://supabase.com 가입 → New Project 생성
   2. SQL Editor에서 아래 테이블 생성 SQL 실행:

      create table if not exists bigact (
        id text primary key,
        kind text not null,
        data jsonb not null,
        updated_at timestamptz default now()
      );
      alter table bigact enable row level security;
      create policy "team access" on bigact for all using (true) with check (true);

   3. Settings → API 에서 Project URL 과 anon/publishable 키를 복사해 아래에 붙여넣기
   4. 저장 후 재배포
   ========================================================= */

const SUPABASE_URL = 'https://ytgermhcagfjnoxinvnd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_65IzteQ16sDtOF1OxmpPbg_XQqUYBTc';

/* ---------------------------------------------------------
   관계형 테이블(members·timesheets 등) 접근용 Supabase JS 클라이언트.
   · 위 URL/KEY 를 그대로 재사용합니다(다른 파일에 키를 중복 작성하지 않음).
   · @supabase/supabase-js UMD 가 이 파일보다 먼저 로드되어 window.supabase 를 제공해야 합니다.
   · 라이브러리나 키가 없으면 null → 각 기능이 안전하게 비활성화됩니다.
   기존 bigact 동기화(app.js)는 이 클라이언트를 쓰지 않고 기존 REST 방식을 그대로 유지합니다.
--------------------------------------------------------- */
const supabaseClient = (typeof window !== 'undefined' && window.supabase && SUPABASE_URL && SUPABASE_KEY)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;
