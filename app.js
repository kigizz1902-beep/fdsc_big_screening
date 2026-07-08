/* =========================================================
   빅활동: 민활기 다큐 상영회 — 협업 웹앱 v3
   localStorage + Supabase 클라우드 동기화
   ========================================================= */

/* ---------- 클라우드 설정 (Supabase) ----------
   아래 두 값을 채우면 모든 기기·팀원이 같은 데이터를 실시간 공유합니다.
   비워두면 기존처럼 이 브라우저에만 저장됩니다(로컬 모드).

   설정 방법:
   1. https://supabase.com 무료 가입 → New Project 생성
   2. 프로젝트 대시보드 → SQL Editor에서 아래 SQL 실행:

      create table if not exists bigact (
        id text primary key,
        kind text not null,
        data jsonb not null,
        updated_at timestamptz default now()
      );
      alter table bigact enable row level security;
      create policy "team access" on bigact for all using (true) with check (true);

   3. Settings → API 에서 Project URL과 anon public 키를 복사해 아래에 붙여넣기
   4. 저장 후 Vercel에 다시 배포
------------------------------------------------ */
const SUPABASE_URL = 'https://ytgermhcagfjnoxinvnd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_65IzteQ16sDtOF1OxmpPbg_XQqUYBTc';

/* ---------- 상수 ---------- */
const MEMBERS = [
  { name: '김도은', color: '#fece00' },
  { name: '성솔푸른', color: '#ff7300' },
  { name: '송윤서', color: '#31cc66' },
  { name: '오가현', color: '#fea1cd' },
  { name: '정설향', color: '#fea501' },
  { name: '채서린', color: '#00a3fe' },
];
const MEMBER_COLOR = Object.fromEntries(MEMBERS.map(m => [m.name, m.color]));

const REGIONS = ['서울', '수도권', '충청', '강원', '경남', '경북', '전라', '전남', '제주'];

/* 캘린더 항목별 색상 — 서로 겹치지 않게 배정
   미팅(파랑) / 상영회(주황) / 기타(초록) / 이번주 목표(핑크)
   회의록(노랑) / 상영일정(보라) / 작업기록(회색) */
const SECTORS = {
  '미팅': '#00a3fe',
  '상영회': '#ff7300',
  '기타': '#31cc66',
  '이번주 목표': '#fea1cd',
};

const CINEMA_STATUS = {
  '확인중': '#fece00',
  '컨택완료': '#00a3fe',
  '상영일정': '#a78bfa',
};

/* 회의록 캘린더 반영 색상 (회의 날짜 / 다음 회의 예정) */
const MINUTE_COLOR = '#fece00';
/* 작업기록 색상 */
const TS_COLOR = '#9a8f95';

const IDEA_TYPES = {
  '오프라인 상영회': '#fea1cd',
  '온라인 상영회': '#00a3fe',
  '기타': '#fece00',
};

/* 회계 — 계정과목 체계 (유형 → 분류 → 계정과목) */
const INCOME_STRUCTURE = {
  '고유목적사업수익': ['회비', '후원금', '지원금'],
  '수익사업': ['콘텐츠 수익', '도서판매 수익', '수익사업-지원금'],
  '영업외수익': ['보증금수입', '이자', '잡이익', '기타수입'],
};
const EXPENSE_STRUCTURE = {
  '인건비': ['인건비'],
  '운영비': ['회의비', '여비교통비', '지급임차료', '대관', '운반, 배송', '서비스 이용료'],
  '제작 및 비품': ['제작비', '소모품비'],
  '기타': ['세금과공과금', '지급수수료', '판매수수료', '기타'],
  '영업외비용': ['잡손실'],
};
/* 분류(그룹)별 색상 — 차트/태그용 */
const INCOME_GROUP_COLORS = {
  '고유목적사업수익': '#31cc66',
  '수익사업': '#00a3fe',
  '영업외수익': '#fea501',
};
const EXPENSE_GROUP_COLORS = {
  '인건비': '#fea1cd',
  '운영비': '#00a3fe',
  '제작 및 비품': '#ff7300',
  '기타': '#fece00',
  '영업외비용': '#9a8f95',
};

/* 항목(계정과목) 선택 시 참고 단가표 힌트 */
const ACCOUNT_PRICE_HINTS = {
  '인건비': [
    '활동비: 월 20시간 기준 150,000~250,000',
    '일일 도우미 스태프: 일당 50,000~100,000',
    '연사비: 회/팀당 200,000~400,000',
    '인터뷰·자문 사례비: 회/팀당 100,000~200,000',
    '(내부) 디자인비: 1,500,000~',
    '원고비: 200매 원고지당 10,000~15,000',
    '사진가 섭외비: 반일촬영/사진 수당 300,000~500,000',
  ],
  '회의비': ['커피/다과비: 인당 ~8,000', '식비: 인당 ~15,000', '회식: 인당 ~30,000'],
  '여비교통비': ['지역간 이동: ~50,000'],
  '소모품비': ['소품 대여비·간단한 비품(포스트잇, 펜 등) 구입'],
};

/* 구버전 회계 구분/계정 → (분류, 계정과목) 매핑 */
function mapLegacyAccount(type, key) {
  key = String(key || '').trim();
  if (type === '수입') {
    const m = {
      '모금수익': ['고유목적사업수익', '후원금'],
      '지원금': ['고유목적사업수익', '지원금'],
      '사업수익': ['수익사업', '콘텐츠 수익'],
      '회비': ['고유목적사업수익', '회비'],
      '후원금': ['고유목적사업수익', '후원금'],
    };
    return m[key] || ['고유목적사업수익', '후원금'];
  }
  const m = {
    '인건비': ['인건비', '인건비'],
    '회의비': ['운영비', '회의비'],
    '여비교통비': ['운영비', '여비교통비'],
    '지급임차료': ['운영비', '지급임차료'],
    '대관': ['운영비', '대관'],
    '대관비': ['운영비', '대관'],
    '서비스 이용료': ['운영비', '서비스 이용료'],
    '운반 배송비': ['운영비', '운반, 배송'],
    '운반, 배송': ['운영비', '운반, 배송'],
    '제작비': ['제작 및 비품', '제작비'],
    '소모품비': ['제작 및 비품', '소모품비'],
    '운영비': ['운영비', '회의비'],
    '기타': ['기타', '기타'],
  };
  return m[key] || ['기타', '기타'];
}

const MONTHS = [ // 2026년 7~12월
  { y: 2026, m: 6 }, { y: 2026, m: 7 }, { y: 2026, m: 8 }, { y: 2026, m: 9 }, { y: 2026, m: 10 }, { y: 2026, m: 11 },
];

const SEED_EVENTS = [
  { name: '킥오프 미팅', sector: '미팅', date: '2026-07-06', memo: '프로젝트 시작 · 역할 분담' },
  { name: '중간점검 워크숍', sector: '미팅', date: '2026-08-14', memo: '진행상황 점검' },
  { name: '결과물 완료', sector: '기타', date: '2026-09-04', memo: '결과물 마감' },
  { name: '활동 회고 및 아카이브', sector: '기타', date: '2026-09-07', memo: '회고 미팅' },
];

/* ---------- 저장소 ---------- */
const DB_KEY = 'bigact_screening_db_v1';
const DEFAULT_DB = {
  events: [], cinemas: [], ideas: [], accounting: [], timestamps: [], minutes: [],
  budget: 0, seeded: false,
};

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return migrateDB(seedDB(structuredClone(DEFAULT_DB)));
    const parsed = JSON.parse(raw);
    return migrateDB({ ...structuredClone(DEFAULT_DB), ...parsed });
  } catch (e) {
    console.error('DB load 실패', e);
    return migrateDB(seedDB(structuredClone(DEFAULT_DB)));
  }
}
function seedDB(db) {
  if (!db.seeded) {
    db.events = SEED_EVENTS.map(e => ({ id: uid(), time: '', dateEnd: '', ...e }));
    db.seeded = true;
  }
  return db;
}
/* 구버전 데이터 자동 이관 — 멤버명·회계 구분·영화관 복수날짜 등 */
function migrateDB(db) {
  /* 옛 이름(모든 세대) → 현재 실명 */
  const RENAME_MAP = {
    '도은': '김도은', '가현': '오가현', '윤서': '송윤서', '서린': '채서린', '설향': '정설향',
    '상아': '성솔푸른', '추가인원': '성솔푸른', 'FDSC': '성솔푸른',
  };
  const rename = (s) => RENAME_MAP[s] || s;

  (db.timestamps || []).forEach(t => { t.name = rename(t.name); });
  (db.ideas || []).forEach(i => {
    i.author = rename(i.author);
    if (i.pinned === undefined) i.pinned = false;
    if (i.likes === undefined) i.likes = 0;
  });
  (db.cinemas || []).forEach(c => {
    c.manager = rename(c.manager || '');
    // date(단일) → dates(복수) 이관
    if (!Array.isArray(c.dates)) c.dates = c.date ? [c.date] : [];
    delete c.date;
  });
  (db.events || []).forEach(e => {
    if (e.dateEnd === undefined) e.dateEnd = '';
    // 시간을 15분 단위로 반올림
    if (e.time) {
      const [h, mn] = e.time.split(':').map(Number);
      if (!isNaN(h) && !isNaN(mn)) {
        let r = Math.round(mn / 15) * 15;
        let hh = h;
        if (r === 60) { r = 0; hh = (h + 1) % 24; }
        e.time = `${pad(hh)}:${pad(r)}`;
      }
    }
  });
  (db.accounting || []).forEach(a => {
    // 입금/출금 → 수입/지출
    if (a.type === '입금') a.type = '수입';
    if (a.type === '출금') a.type = '지출';
    if (a.type !== '수입' && a.type !== '지출') a.type = '지출';
    // (구분, 항목) 체계로 이관
    const struct = a.type === '수입' ? INCOME_STRUCTURE : EXPENSE_STRUCTURE;
    if (!(a.group && a.account && struct[a.group] && struct[a.group].includes(a.account))) {
      const [g, acc] = mapLegacyAccount(a.type, a.category || a.account || a.group);
      a.group = g; a.account = acc;
    }
    delete a.category;
    // 수량·횟수·단가 체계로 이관 (금액 = A × B × C)
    if (a.unit === undefined) {
      a.qty = Number(a.qty) || 1;
      a.times = Number(a.times) || 1;
      a.unit = Number(a.amount) || 0; // 기존 금액을 단가로 승계
      a.amount = a.qty * a.times * a.unit;
    }
    // 구 자유입력 항목(item) → 내용으로 병합
    if (a.item !== undefined) {
      if (a.item) a.content = [a.item, a.content].filter(Boolean).join(' / ');
      delete a.item;
    }
  });
  (db.minutes || []).forEach(m => {
    if (!Array.isArray(m.participants)) m.participants = [];
    if (!Array.isArray(m.guests)) m.guests = [];
    m.participants = m.participants.map(rename);
  });
  if (!Array.isArray(db.minutes)) db.minutes = [];
  return db;
}
function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || String(e).includes('exceeded'))) {
      toast('저장 공간이 가득 찼어요. 이미지 용량을 줄여주세요.');
    } else {
      toast('저장에 실패했습니다.');
    }
    console.error(e);
  }
  schedulePush(); // 클라우드 모드면 변경분 업로드
}

/* =========================================================
   클라우드 동기화 (Supabase REST)
   - 항목(이벤트/영화관/…) 하나가 서버의 행 하나 → 팀원 간 동시 편집에도 안전
   - 저장 시 변경분만 업로드, 30초마다 + 화면 복귀 시 서버에서 갱신
   ========================================================= */
const CLOUD_KINDS = [
  ['events', 'event'], ['cinemas', 'cinema'], ['ideas', 'idea'],
  ['accounting', 'acc'], ['timestamps', 'ts'], ['minutes', 'minute'],
];
let lastCloud = null;   // 마지막으로 서버와 일치했던 상태 (id → row JSON)
let pushTimer = null;
let pulling = false;

function cloudEnabled() { return !!(SUPABASE_URL && SUPABASE_KEY); }

function cloudHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/* DB 객체 → 서버 행 목록 */
function dbToRows(db) {
  const rows = [];
  CLOUD_KINDS.forEach(([coll, kind]) => {
    (db[coll] || []).forEach(item => rows.push({ id: item.id, kind, data: item }));
  });
  rows.push({ id: '__settings__', kind: 'settings', data: { budget: db.budget || 0 } });
  return rows;
}

/* 서버 행 목록 → DB 객체 */
function rowsToDb(rows) {
  const db = structuredClone(DEFAULT_DB);
  db.seeded = true; // 클라우드가 비어 보여도 마일스톤 중복 생성 방지
  const kindToColl = Object.fromEntries(CLOUD_KINDS.map(([c, k]) => [k, c]));
  rows.forEach(r => {
    if (r.kind === 'settings') { db.budget = Number(r.data?.budget || 0); return; }
    const coll = kindToColl[r.kind];
    if (coll && r.data && r.data.id) db[coll].push(r.data);
  });
  return db;
}

function rowMap(rows) {
  const m = {};
  rows.forEach(r => { m[r.id] = JSON.stringify({ kind: r.kind, data: r.data }); });
  return m;
}

function setSyncStatus(state, msg) {
  const elx = $('#syncStatus');
  if (!elx) return;
  const dot = { on: '#31cc66', off: '#9a8f95', err: '#ff7300', sync: '#00a3fe' }[state] || '#9a8f95';
  elx.innerHTML = `<span class="tag-dot" style="background:${dot}"></span> ${esc(msg)}`;
}

/* 서버에서 전체 데이터 가져오기 */
async function cloudFetchRows() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bigact?select=id,kind,data`, { headers: cloudHeaders() });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.json();
}

/* 변경 감지용 스탬프 (행 개수 + 최신 수정시각) — 응답이 수백 바이트라 전송량 절약
   추가/수정은 updated_at, 삭제는 행 개수로 잡힘 */
async function cloudCheckStamp() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bigact?select=updated_at&order=updated_at.desc&limit=1`, {
    headers: { ...cloudHeaders(), 'Prefer': 'count=exact' },
  });
  if (!res.ok) throw new Error(`stamp ${res.status}`);
  const rows = await res.json();
  const count = (res.headers.get('content-range') || '').split('/')[1] || '?';
  return `${count}|${rows[0]?.updated_at || ''}`;
}
let lastStamp = null;

async function cloudUpsert(rows) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bigact`, {
    method: 'POST',
    headers: { ...cloudHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(rows.map(r => ({ ...r, updated_at: new Date().toISOString() }))),
  });
  if (!res.ok) throw new Error(`upsert ${res.status}`);
}

async function cloudDelete(ids) {
  if (!ids.length) return;
  const list = ids.map(id => `"${id.replace(/"/g, '')}"`).join(',');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bigact?id=in.(${encodeURIComponent(list)})`, {
    method: 'DELETE', headers: cloudHeaders(),
  });
  if (!res.ok) throw new Error(`delete ${res.status}`);
}

/* 변경분 업로드 (디바운스) */
function schedulePush() {
  if (!cloudEnabled() || lastCloud === null) return; // 최초 동기화 전이면 보류
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushDiff, 600);
}

async function pushDiff() {
  if (!cloudEnabled() || lastCloud === null) return;
  const rows = dbToRows(DB);
  const cur = rowMap(rows);
  const upserts = rows.filter(r => lastCloud[r.id] !== cur[r.id]);
  const deletes = Object.keys(lastCloud).filter(id => !(id in cur));
  if (!upserts.length && !deletes.length) return;
  try {
    setSyncStatus('sync', '동기화 중…');
    await cloudUpsert(upserts);
    await cloudDelete(deletes);
    lastCloud = cur;
    lastStamp = null; // 내가 올린 변경 — 다음 폴링에서 한 번 전체 대조
    setSyncStatus('on', '클라우드 연결됨');
  } catch (e) {
    console.error('cloud push 실패', e);
    setSyncStatus('err', '연결 안 됨 · 이 기기에만 저장 중');
  }
}

/* 서버 → 로컬 갱신. 모달 열려 있으면(입력 중) 건너뜀 */
async function pullCloud({ silent } = { silent: true }) {
  if (!cloudEnabled() || pulling) return;
  pulling = true;
  try {
    /* 평상시엔 가벼운 스탬프만 확인하고, 변한 게 없으면 전체 다운로드 생략 */
    let stamp = null;
    if (lastCloud !== null) {
      stamp = await cloudCheckStamp();
      if (stamp === lastStamp) return;
    }
    const rows = await cloudFetchRows();
    const serverMap = rowMap(rows);

    if (lastCloud === null) {
      /* 최초 동기화: 서버 데이터와 로컬 데이터를 id 기준으로 합침
         (같은 id는 서버 우선, 이 기기에만 있는 항목은 서버로 업로드) */
      const localRows = dbToRows(DB);
      const localOnly = localRows.filter(r => !(r.id in serverMap) && r.id !== '__settings__');
      const merged = rowsToDb(rows);
      localOnly.forEach(r => {
        const coll = CLOUD_KINDS.find(([, k]) => k === r.kind)?.[0];
        if (coll) merged[coll].push(r.data);
      });
      if (!rows.some(r => r.id === '__settings__')) merged.budget = DB.budget;
      DB = migrateDB(merged);
      localStorage.setItem(DB_KEY, JSON.stringify(DB));
      lastCloud = serverMap;
      if (localOnly.length || !rows.some(r => r.id === '__settings__')) await pushDiff();
      lastStamp = await cloudCheckStamp().catch(() => null);
      setSyncStatus('on', '클라우드 연결됨');
      rerender();
    } else if (JSON.stringify(serverMap) !== JSON.stringify(lastCloud)) {
      /* 다른 팀원의 변경 반영 — 입력 중(모달 열림)이면 다음 주기로 미룸 (스탬프 기록도 미룸) */
      if (!$('#modalRoot').hidden) return;
      DB = migrateDB(rowsToDb(rows));
      localStorage.setItem(DB_KEY, JSON.stringify(DB));
      lastCloud = serverMap;
      lastStamp = stamp;
      rerender();
      if (!silent) toast('다른 팀원의 변경사항을 불러왔어요');
    } else {
      lastStamp = stamp; // 내용 동일 — 스탬프만 갱신
    }
  } catch (e) {
    console.error('cloud pull 실패', e);
    setSyncStatus('err', '연결 안 됨 · 이 기기에만 저장 중');
  } finally {
    pulling = false;
  }
}

function initCloud() {
  if (!cloudEnabled()) { setSyncStatus('off', '로컬 모드 (기기별 저장)'); return; }
  setSyncStatus('sync', '연결 중…');
  pullCloud();
  setInterval(() => pullCloud(), 30000);            // 30초마다 갱신
  window.addEventListener('focus', () => pullCloud());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullCloud(); });
}

/* ---------- 유틸 ---------- */
function uid() { return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function $(sel, root = document) { return root.querySelector(sel); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
function dateToStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return dateToStr(new Date()); }
function pad(n) { return String(n).padStart(2, '0'); }
function comma(n) { return Number(n || 0).toLocaleString('ko-KR'); }
function won(n) { return '₩' + comma(n); }
function stampToday() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${y}.${m}.${d}`;
}
function fmtDateShort(str) { // 07.12 형식
  if (!str) return '';
  const p = str.split('-');
  return `${p[1]}.${p[2]}`;
}
function fmtRange(e) {
  return e.dateEnd && e.dateEnd !== e.date ? `${fmtDate(e.date)} ~ ${fmtDate(e.dateEnd)}` : fmtDate(e.date);
}
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
function weekdayKo(str) {
  const [y, m, d] = str.split('-').map(Number);
  return WEEKDAYS_KO[new Date(y, m - 1, d).getDay()];
}
function textColorOn(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#180f14' : '#ffffff';
}
/* 이벤트가 특정 날짜를 포함하는가 (기간 일정 지원) */
function eventOnDate(e, dateStr) {
  const end = e.dateEnd || e.date;
  return e.date <= dateStr && dateStr <= end;
}
/* 해당 날짜가 속한 한 주(일~토) 범위 */
function weekRangeOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const sun = new Date(base); sun.setDate(base.getDate() - base.getDay());
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  return [dateToStr(sun), dateToStr(sat)];
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

let DB = loadDB();

/* ---------- 모달 ---------- */
let modalOnClose = null;
function openModal({ title, body, footer, onClose }) {
  $('#modalTitle').textContent = title;
  const b = $('#modalBody');
  b.innerHTML = '';
  b.appendChild(typeof body === 'string' ? el(`<div>${body}</div>`) : body);
  const f = $('#modalFoot');
  f.innerHTML = '';
  if (footer) footer.forEach(btn => f.appendChild(btn));
  modalOnClose = onClose || null;
  $('#modalRoot').hidden = false;
  document.body.style.overflow = 'hidden';
  const firstInput = b.querySelector('input, select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}
function closeModal() {
  $('#modalRoot').hidden = true;
  document.body.style.overflow = '';
  if (modalOnClose) modalOnClose();
  modalOnClose = null;
}
function mkBtn(label, cls, onClick, title) {
  const b = el(`<button class="btn ${cls}" ${title ? `title="${esc(title)}"` : ''}>${label}</button>`);
  b.addEventListener('click', onClick);
  return b;
}
function confirmDelete(msg, onConfirm) {
  openModal({
    title: '삭제 확인',
    body: el(`<p style="padding:6px 0 4px;font-size:14.5px;line-height:1.6;">${esc(msg)}</p><p class="hint">삭제하면 되돌릴 수 없습니다.</p>`),
    footer: [
      mkBtn('취소', 'btn-ghost', closeModal),
      mkBtn('삭제', 'btn-danger', () => { onConfirm(); closeModal(); }),
    ],
  });
}
/* 색상 pill 단일 선택 위젯 — 선택값을 getter로 반환 */
function pillSelect(container, entries, initial, onChange) {
  let value = initial;
  entries.forEach(([name, color]) => {
    const p = el(`<button type="button" class="pill ${name === value ? 'selected' : ''}">${esc(name)}</button>`);
    const paint = (on) => {
      p.classList.toggle('selected', on);
      p.style.background = on ? color : '';
      p.style.color = on ? textColorOn(color) : '';
    };
    paint(name === value);
    p.addEventListener('click', () => {
      value = name;
      container.querySelectorAll('.pill').forEach(x => { x.classList.remove('selected'); x.style.background = ''; x.style.color = ''; });
      paint(true);
      if (onChange) onChange(value);
    });
    container.appendChild(p);
  });
  return () => value;
}
/* 색상 pill 다중 선택 위젯 */
function pillMultiSelect(container, entries, initialArr) {
  const selected = new Set(initialArr || []);
  entries.forEach(([name, color]) => {
    const p = el(`<button type="button" class="pill">${esc(name)}</button>`);
    const paint = () => {
      const on = selected.has(name);
      p.classList.toggle('selected', on);
      p.style.background = on ? color : '';
      p.style.color = on ? textColorOn(color) : '';
    };
    paint();
    p.addEventListener('click', () => {
      if (selected.has(name)) selected.delete(name); else selected.add(name);
      paint();
    });
    container.appendChild(p);
  });
  return () => [...selected];
}

/* ---------- 라우터 ---------- */
const VIEWS = {
  calendar: { title: '캘린더', render: renderCalendar },
  minutes: { title: '회의록', render: renderMinutes },
  cinemas: { title: '영화관 리스트', render: renderCinemas },
  ideas: { title: '아이디어(메모)', render: renderIdeas },
  accounting: { title: '회계 시트', render: renderAccounting },
  timestamps: { title: '타임스탬프', render: renderTimestamps },
};
let currentView = 'calendar';

function navigate(view) {
  if (!VIEWS[view]) view = 'calendar';
  currentView = view;
  $('#pageTitle').textContent = VIEWS[view].title;
  document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderView();
}
/* [버그 수정] rerender 시 topbar/view를 항상 비우고 다시 그림 — 버튼 중복 방지 */
function renderView() {
  $('#topbarActions').innerHTML = '';
  $('#view').innerHTML = '';
  VIEWS[currentView].render();
  addTopbarAction(mkBtn('🔄', 'btn-sm btn-icon', openDataModal, '백업 · 복원'));
}
function rerender() { renderView(); }

function addTopbarAction(btn) { $('#topbarActions').appendChild(btn); }

/* =========================================================
   F1. 캘린더
   ========================================================= */
let calIndex = 0;

function renderCalendar() {
  addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportCalendar()));
  addTopbarAction(mkBtn('+ 이벤트', 'btn-sm btn-primary', () => openEventModal(null, todayInRange())));

  const view = $('#view');
  const wrap = el('<div></div>');

  const toolbar = el(`
    <div class="cal-toolbar">
      <button class="btn btn-icon cal-nav-btn" id="calPrev">‹</button>
      <div class="cal-month" id="calMonth"></div>
      <button class="btn btn-icon cal-nav-btn" id="calNext">›</button>
      <div class="cal-legend">
        <span><span class="cal-dot" style="background:${SECTORS['미팅']}"></span>미팅</span>
        <span><span class="cal-dot" style="background:${SECTORS['상영회']}"></span>상영회</span>
        <span><span class="cal-dot" style="background:${SECTORS['기타']}"></span>기타</span>
        <span><span class="cal-dot" style="background:${SECTORS['이번주 목표']}"></span>이번주 목표</span>
        <span><span class="cal-dot" style="background:${MINUTE_COLOR}"></span>회의록</span>
        <span><span class="cal-dot" style="background:${CINEMA_STATUS['상영일정']}"></span>상영일정</span>
        <span><span class="cal-dot" style="background:${TS_COLOR}"></span>작업기록</span>
      </div>
    </div>`);
  wrap.appendChild(toolbar);

  const cal = el('<div class="calendar"></div>');
  const weekdays = el('<div class="cal-weekdays"></div>');
  WEEKDAYS_KO.forEach(d => weekdays.appendChild(el(`<div>${d}</div>`)));
  cal.appendChild(weekdays);
  cal.appendChild(el('<div class="cal-grid" id="calGrid"></div>'));
  wrap.appendChild(cal);

  // 이번 주 일정
  wrap.appendChild(buildWeekSection());

  view.appendChild(wrap);

  $('#calPrev').addEventListener('click', () => { if (calIndex > 0) { calIndex--; drawMonth(); } });
  $('#calNext').addEventListener('click', () => { if (calIndex < MONTHS.length - 1) { calIndex++; drawMonth(); } });

  drawMonth();
}

/* 특정 날짜에 걸리는 회의록 항목 (회의 날짜 / 다음 회의 예정) */
function minuteItemsOnDate(dateStr) {
  const items = [];
  DB.minutes.forEach(m => {
    if (m.date === dateStr) items.push({ label: '📝 ' + m.title, color: MINUTE_COLOR, minute: m, kind: '회의' });
    if (m.nextDate && m.nextDate === dateStr) items.push({ label: '📝 다음 회의: ' + m.title, color: MINUTE_COLOR, minute: m, kind: '다음 회의 예정' });
  });
  return items;
}

function todayInRange() {
  const t = todayStr();
  const first = `${MONTHS[0].y}-${pad(MONTHS[0].m + 1)}-01`;
  const lastM = MONTHS[MONTHS.length - 1];
  const lastDay = new Date(lastM.y, lastM.m + 1, 0).getDate();
  const last = `${lastM.y}-${pad(lastM.m + 1)}-${pad(lastDay)}`;
  return (t >= first && t <= last) ? t : first;
}

/* 이번 주(일~토) 일정 목록 */
function buildWeekSection() {
  const now = new Date();
  const sun = new Date(now); sun.setDate(now.getDate() - now.getDay());
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  const sunStr = dateToStr(sun), satStr = dateToStr(sat);
  const today = todayStr();

  const items = [];
  DB.events.forEach(e => {
    const end = e.dateEnd || e.date;
    if (e.date <= satStr && end >= sunStr) {
      const showDate = e.date >= sunStr ? e.date : sunStr;
      items.push({ date: showDate, time: e.time || '', label: e.name, sub: e.dateEnd && e.dateEnd !== e.date ? `~ ${fmtDate(e.dateEnd)}` : (e.time || '종일'), color: SECTORS[e.sector] || '#9a8f95', onClick: () => openEventDetail(e) });
    }
  });
  DB.cinemas.forEach(c => {
    (c.dates || []).forEach(d => {
      if (d >= sunStr && d <= satStr && c.status === '상영일정') {
        items.push({ date: d, time: '', label: `🎬 ${c.name} 상영`, sub: c.location, color: CINEMA_STATUS['상영일정'], onClick: () => openCinemaModal(c) });
      }
    });
  });
  DB.minutes.forEach(m => {
    if (m.date >= sunStr && m.date <= satStr) {
      items.push({ date: m.date, time: '', label: `📝 ${m.title}`, sub: '회의', color: MINUTE_COLOR, onClick: () => openMinuteDetail(m) });
    }
    if (m.nextDate && m.nextDate >= sunStr && m.nextDate <= satStr) {
      items.push({ date: m.nextDate, time: '', label: `📝 다음 회의: ${m.title}`, sub: '다음 회의 예정', color: MINUTE_COLOR, onClick: () => openMinuteDetail(m) });
    }
  });
  items.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));

  const sec = el(`<div class="week-section"><h3>📌 이번 주 일정 <span class="region-count">${fmtDateShort(sunStr)} ~ ${fmtDateShort(satStr)}</span></h3></div>`);
  if (!items.length) {
    sec.appendChild(el('<div class="empty" style="padding:26px 20px">이번 주 일정이 없어요.</div>'));
    return sec;
  }
  const list = el('<div class="week-list"></div>');
  items.forEach(it => {
    const row = el(`<button class="week-item ${it.date === today ? 'today' : ''}">
      <span class="week-date">${fmtDateShort(it.date)} (${weekdayKo(it.date)})${it.date === today ? ' · 오늘' : ''}</span>
      <span class="cal-dot" style="background:${it.color};flex-shrink:0"></span>
      <span class="week-name">${esc(it.label)}</span>
      <span class="week-sub">${esc(it.sub)}</span>
    </button>`);
    row.addEventListener('click', it.onClick);
    list.appendChild(row);
  });
  sec.appendChild(list);
  return sec;
}

function drawMonth() {
  const { y, m } = MONTHS[calIndex];
  $('#calMonth').textContent = `${y}년 ${m + 1}월`;
  $('#calPrev').style.opacity = calIndex === 0 ? .35 : 1;
  $('#calNext').style.opacity = calIndex === MONTHS.length - 1 ? .35 : 1;

  const grid = $('#calGrid');
  grid.innerHTML = '';
  const startWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = todayStr();

  const cells = [];
  for (let i = startWeekday - 1; i >= 0; i--) cells.push({ day: prevDays - i, other: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, other: false });
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - (startWeekday + daysInMonth) + 1, other: true });

  cells.forEach((c, idx) => {
    const weekday = idx % 7;
    const cell = el(`<div class="cal-cell ${c.other ? 'other' : ''} ${weekday === 0 ? 'sun' : ''} ${weekday === 6 ? 'sat' : ''}"></div>`);
    cell.appendChild(el(`<span class="cal-date">${c.day}</span>`));

    if (!c.other) {
      const dateStr = `${y}-${pad(m + 1)}-${pad(c.day)}`;
      if (dateStr === today) cell.classList.add('today');

      const dayEvents = DB.events.filter(e => eventOnDate(e, dateStr)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      const screenings = [];
      DB.cinemas.forEach(cn => {
        if (cn.status === '상영일정' && (cn.dates || []).includes(dateStr)) screenings.push(cn);
      });
      const dayTs = DB.timestamps.filter(t => t.date === dateStr);

      const evWrap = el('<div class="cal-events"></div>');
      const combined = [
        ...dayEvents.map(e => ({
          label: (e.time && e.date === dateStr ? e.time + ' ' : '') + e.name,
          color: SECTORS[e.sector] || '#9a8f95',
          onClick: () => openEventDetail(e),
        })),
        ...minuteItemsOnDate(dateStr).map(it => ({
          label: it.label,
          color: it.color,
          onClick: () => openMinuteDetail(it.minute), // 캘린더에서 바로 회의록 열람/편집
        })),
        ...screenings.map(cn => ({
          label: '🎬 ' + cn.name,
          color: CINEMA_STATUS['상영일정'],
          onClick: () => openCinemaModal(cn), // 캘린더에서 바로 편집 → 영화관 리스트에도 반영
        })),
      ];
      combined.slice(0, 3).forEach(item => {
        const chip = el(`<button class="cal-ev" style="background:${item.color};color:${textColorOn(item.color)}">${esc(item.label)}</button>`);
        chip.addEventListener('click', (ev) => { ev.stopPropagation(); item.onClick(); });
        evWrap.appendChild(chip);
      });
      if (combined.length > 3) evWrap.appendChild(el(`<div class="cal-more">+${combined.length - 3}개 더</div>`));
      // 타임스탬프 — 클릭하면 그날 작업 기록 모달
      if (dayTs.length) {
        const tsChip = el(`<button class="cal-ev" style="background:${TS_COLOR};color:#fff">⏱ 작업 ${dayTs.length}건</button>`);
        tsChip.addEventListener('click', (ev) => { ev.stopPropagation(); openDayTimestampsModal(dateStr); });
        evWrap.appendChild(tsChip);
      }
      cell.appendChild(evWrap);

      cell.addEventListener('click', () => openEventModal(null, dateStr));
    }
    grid.appendChild(cell);
  });
}

/* 그날의 작업 기록 목록 모달 (캘린더 연동, 편집 가능) */
function openDayTimestampsModal(dateStr) {
  const list = DB.timestamps.filter(t => t.date === dateStr);
  const body = el('<div></div>');
  body.appendChild(el(`<p class="hint" style="margin-bottom:10px">${fmtDate(dateStr)} (${weekdayKo(dateStr)})의 작업 기록</p>`));
  list.forEach(t => {
    const col = MEMBER_COLOR[t.name] || '#9a8f95';
    const row = el(`<div class="detail-row" style="align-items:center">
      <span class="tag" style="background:${col};color:${textColorOn(col)};flex-shrink:0">${esc(t.name)}</span>
      <span class="dv" style="padding-left:10px"><strong>${t.hours}h</strong> · ${esc(t.work)}</span>
      <button class="btn btn-sm btn-icon">편집</button>
    </div>`);
    row.querySelector('button').addEventListener('click', () => { closeModal(); openTsModal(t); });
    body.appendChild(row);
  });
  openModal({
    title: '작업 기록',
    body,
    footer: [
      mkBtn('닫기', 'btn-ghost', closeModal),
      mkBtn('+ 기록 추가', 'btn-primary', () => { closeModal(); openTsModal(null, dateStr); }),
    ],
  });
}

function openEventModal(existing, defaultDate) {
  const e = existing || { name: '', sector: '미팅', date: defaultDate || todayInRange(), dateEnd: '', time: '', memo: '' };
  const [ehh, emm] = (e.time || ':').split(':');
  const hourOpts = ['<option value="">종일</option>'];
  for (let h = 0; h < 24; h++) hourOpts.push(`<option value="${pad(h)}" ${pad(h) === ehh ? 'selected' : ''}>${pad(h)}시</option>`);
  const minOpts = ['00', '15', '30', '45'].map(mn => `<option value="${mn}" ${mn === emm ? 'selected' : ''}>${mn}분</option>`).join('');

  const form = el(`
    <form id="evForm">
      <div class="field">
        <label>이벤트명 <span class="req">*</span></label>
        <input type="text" name="name" placeholder="예) 킥오프 미팅" value="${esc(e.name)}" required />
      </div>
      <div class="field">
        <label>섹터 <span class="req">*</span></label>
        <div class="pill-select" id="sectorPick"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>시작일 <span class="req">*</span></label><input type="date" name="date" value="${e.date}" required /></div>
        <div class="field"><label>종료일 <span style="color:var(--muted);font-weight:400">(기간 일정)</span></label><input type="date" name="dateEnd" value="${e.dateEnd || ''}" /></div>
      </div>
      <div class="field">
        <label>시간 <span style="color:var(--muted);font-weight:400">(15분 단위)</span></label>
        <div class="field-row" style="margin:0">
          <div class="field" style="margin:0"><select name="hh">${hourOpts.join('')}</select></div>
          <div class="field" style="margin:0"><select name="mm" ${ehh === '' || ehh === undefined ? 'disabled' : ''}>${minOpts}</select></div>
        </div>
      </div>
      <div class="field">
        <label>메모</label>
        <textarea name="memo" placeholder="장소, 준비물 등">${esc(e.memo)}</textarea>
      </div>
    </form>`);

  const dateIn = form.querySelector('[name=date]'), dateEndIn = form.querySelector('[name=dateEnd]');
  /* '이번주 목표' 섹터: 시작일이 속한 한 주(일~토)를 통째로 선택 */
  const applyWeekGoal = () => {
    const base = dateIn.value || todayInRange();
    const [sun, sat] = weekRangeOf(base);
    dateIn.value = sun;
    dateEndIn.value = sat;
  };
  const getSector = pillSelect($('#sectorPick', form), Object.entries(SECTORS), e.sector, (v) => {
    if (v === '이번주 목표') applyWeekGoal();
  });
  dateIn.addEventListener('change', () => { if (getSector() === '이번주 목표') applyWeekGoal(); });

  const hhSel = form.querySelector('[name=hh]'), mmSel = form.querySelector('[name=mm]');
  hhSel.addEventListener('change', () => { mmSel.disabled = hhSel.value === ''; });

  const footer = [];
  if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => {
    confirmDelete(`'${e.name}' 이벤트를 삭제할까요?`, () => {
      DB.events = DB.events.filter(x => x.id !== e.id); saveDB(); rerender(); toast('삭제되었습니다');
    });
  }));
  footer.push(mkBtn('취소', 'btn-ghost', closeModal));
  footer.push(mkBtn(existing ? '저장' : '추가', 'btn-primary', () => {
    const fd = new FormData(form);
    const name = fd.get('name').trim();
    if (!name) return toast('이벤트명을 입력해주세요');
    let date = fd.get('date');
    let dateEnd = fd.get('dateEnd');
    if (getSector() === '이번주 목표') [date, dateEnd] = weekRangeOf(date || todayInRange()); // 저장 시에도 1주 보장
    if (dateEnd && dateEnd < date) return toast('종료일이 시작일보다 빠를 수 없어요');
    if (dateEnd === date) dateEnd = '';
    const time = hhSel.value === '' ? '' : `${hhSel.value}:${mmSel.value || '00'}`;
    const data = { name, sector: getSector(), date, dateEnd, time, memo: fd.get('memo').trim() };
    if (existing) Object.assign(existing, data);
    else DB.events.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '이벤트가 추가되었습니다');
  }));

  openModal({ title: existing ? '이벤트 편집' : '이벤트 추가', body: form, footer });
}

function openEventDetail(e) {
  const color = SECTORS[e.sector] || '#9a8f95';
  const body = el(`
    <div>
      <div style="margin-bottom:12px"><span class="tag" style="background:${color};color:${textColorOn(color)}">${esc(e.sector)}</span></div>
      <div class="detail-row"><span class="dk">이벤트</span><span class="dv"><strong>${esc(e.name)}</strong></span></div>
      <div class="detail-row"><span class="dk">날짜</span><span class="dv">${fmtRange(e)}${e.time ? ' · ' + e.time : ' · 종일'}</span></div>
      ${e.memo ? `<div class="detail-row"><span class="dk">메모</span><span class="dv" style="white-space:pre-wrap">${esc(e.memo)}</span></div>` : ''}
    </div>`);
  openModal({
    title: '이벤트 상세', body,
    footer: [
      mkBtn('닫기', 'btn-ghost', closeModal),
      mkBtn('편집', 'btn-primary', () => { closeModal(); openEventModal(e); }),
    ],
  });
}

/* =========================================================
   F2. 영화관 리스트
   ========================================================= */
let cinemaFilter = '전체';

function renderCinemas() {
  addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportCinemas()));
  addTopbarAction(mkBtn('+ 영화관', 'btn-sm btn-primary', () => openCinemaModal(null)));

  const view = $('#view');

  const filterBar = el('<div class="filter-bar"></div>');
  ['전체', ...Object.keys(CINEMA_STATUS)].forEach(s => {
    const chip = el(`<button class="chip ${cinemaFilter === s ? 'active' : ''}">${s}</button>`);
    chip.addEventListener('click', () => { cinemaFilter = s; rerender(); });
    filterBar.appendChild(chip);
  });
  view.appendChild(filterBar);

  const list = DB.cinemas.filter(c => cinemaFilter === '전체' || c.status === cinemaFilter);
  if (!list.length) {
    view.appendChild(el(`<div class="empty"><span class="empty-emoji">🎞️</span>${DB.cinemas.length ? '해당 상태의 영화관이 없어요.' : '아직 등록된 영화관이 없어요.<br>우측 상단 <b>+ 영화관</b>으로 추가해보세요.'}</div>`));
    return;
  }

  REGIONS.forEach(region => {
    const inRegion = list.filter(c => c.region === region);
    if (!inRegion.length) return;
    const group = el(`<div class="region-group">
      <div class="region-head"><h3>${region}</h3><span class="region-count">${inRegion.length}</span></div>
      <div class="cinema-list"></div></div>`);
    const cl = $('.cinema-list', group);
    inRegion.forEach(c => cl.appendChild(cinemaItem(c)));
    view.appendChild(group);
  });
}

function cinemaItem(c) {
  const color = CINEMA_STATUS[c.status] || '#9a8f95';
  const datesTxt = (c.dates || []).map(fmtDate).join(', ');
  const item = el(`<div class="cinema-item">
    <div class="cinema-main">
      <div class="cinema-name">${esc(c.name)}</div>
      <div class="cinema-meta">
        <span>📍 ${esc(c.location)}</span>
        ${c.manager ? `<span>👤 ${esc(c.manager)}</span>` : ''}
        ${c.contact ? `<span>📞 ${esc(c.contact)}</span>` : ''}
        ${datesTxt ? `<span>🎬 ${datesTxt}</span>` : ''}
      </div>
      ${c.memo ? `<div class="cinema-meta"><span>📝 ${esc(c.memo)}</span></div>` : ''}
    </div>
    <div class="cinema-tags">
      <span class="tag" style="background:${color};color:${textColorOn(color)}">${c.status}</span>
      <div class="row-actions">
        <button class="btn btn-sm btn-icon" data-act="edit">편집</button>
        <button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button>
      </div>
    </div>
  </div>`);
  $('[data-act=edit]', item).addEventListener('click', () => openCinemaModal(c));
  $('[data-act=del]', item).addEventListener('click', () => confirmDelete(`'${c.name}'을(를) 삭제할까요?`, () => {
    DB.cinemas = DB.cinemas.filter(x => x.id !== c.id); saveDB(); rerender(); toast('삭제되었습니다');
  }));
  return item;
}

function openCinemaModal(existing) {
  const c = existing || { name: '', location: '', region: '서울', status: '확인중', dates: [], manager: '', contact: '', memo: '' };
  let dates = [...(c.dates || [])];

  const form = el(`
    <form id="cinemaForm">
      <div class="field">
        <label>어느 영화관인가요? <span class="req">*</span></label>
        <input type="text" name="name" placeholder="예) 인디스페이스" value="${esc(c.name)}" required />
      </div>
      <div class="field-row">
        <div class="field" style="flex:1.4"><label>어디에 있나요? <span class="req">*</span></label>
          <input type="text" name="location" placeholder="예) 서울 종로구" value="${esc(c.location)}" required /></div>
        <div class="field"><label>지역 <span class="req">*</span></label>
          <select name="region">${REGIONS.map(r => `<option ${r === c.region ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      </div>
      <div class="field">
        <label>상태 <span class="req">*</span></label>
        <div class="pill-select" id="statusPick"></div>
      </div>
      <div class="field">
        <label>상영 날짜 <span style="color:var(--muted);font-weight:400">(복수 선택 가능 · 상영일정 상태 시 캘린더 자동 등록)</span></label>
        <div class="field-row" style="margin:0">
          <div class="field" style="margin:0;flex:1.6"><input type="date" id="cinemaDateInput" min="2026-07-01" max="2026-12-31" /></div>
          <div class="field" style="margin:0"><button type="button" class="btn btn-block" id="addDateBtn">+ 날짜 추가</button></div>
        </div>
        <div class="chips" id="dateChips"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>담당자</label><input type="text" name="manager" placeholder="예) 김도은" value="${esc(c.manager)}" /></div>
        <div class="field"><label>연락처</label><input type="text" name="contact" placeholder="전화번호" value="${esc(c.contact)}" /></div>
      </div>
      <div class="field"><label>메모</label><textarea name="memo" placeholder="통화 내용, 특이사항">${esc(c.memo)}</textarea></div>
    </form>`);

  const getStatus = pillSelect($('#statusPick', form), Object.entries(CINEMA_STATUS), c.status);

  const chipsBox = $('#dateChips', form);
  const drawChips = () => {
    chipsBox.innerHTML = '';
    dates.sort();
    dates.forEach(d => {
      const chip = el(`<span class="chip-item">🎬 ${fmtDate(d)} <button type="button" aria-label="삭제">✕</button></span>`);
      chip.querySelector('button').addEventListener('click', () => { dates = dates.filter(x => x !== d); drawChips(); });
      chipsBox.appendChild(chip);
    });
  };
  drawChips();
  $('#addDateBtn', form).addEventListener('click', () => {
    const v = $('#cinemaDateInput', form).value;
    if (!v) return toast('날짜를 먼저 선택해주세요');
    if (dates.includes(v)) return toast('이미 추가된 날짜예요');
    dates.push(v);
    $('#cinemaDateInput', form).value = '';
    drawChips();
  });

  const footer = [];
  if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => confirmDelete(`'${c.name}'을(를) 삭제할까요?`, () => {
    DB.cinemas = DB.cinemas.filter(x => x.id !== c.id); saveDB(); closeModal(); rerender(); toast('삭제되었습니다');
  })));
  footer.push(mkBtn('취소', 'btn-ghost', closeModal));
  footer.push(mkBtn(existing ? '저장' : '등록', 'btn-primary', () => {
    const fd = new FormData(form);
    const name = fd.get('name').trim(), location = fd.get('location').trim();
    if (!name) return toast('영화관 이름을 입력해주세요');
    if (!location) return toast('위치를 입력해주세요');
    // 입력창에 남아있는 날짜도 반영
    const pending = $('#cinemaDateInput', form).value;
    if (pending && !dates.includes(pending)) dates.push(pending);
    const data = {
      name, location, region: fd.get('region'), status: getStatus(),
      dates: [...dates].sort(), manager: fd.get('manager').trim(), contact: fd.get('contact').trim(), memo: fd.get('memo').trim(),
    };
    if (existing) Object.assign(existing, data);
    else DB.cinemas.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender();
    toast(existing ? '수정되었습니다' : '영화관이 등록되었습니다');
  }));

  openModal({ title: existing ? '영화관 편집' : '영화관 등록', body: form, footer });
}

/* =========================================================
   F3. 아이디어(메모)
   ========================================================= */
let ideaFilter = '전체';

function renderIdeas() {
  addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportIdeas()));
  addTopbarAction(mkBtn('+ 아이디어', 'btn-sm btn-primary', () => openIdeaModal(null)));

  const view = $('#view');
  const filterBar = el('<div class="filter-bar"></div>');
  ['전체', ...Object.keys(IDEA_TYPES)].forEach(t => {
    const chip = el(`<button class="chip ${ideaFilter === t ? 'active' : ''}">${t}</button>`);
    chip.addEventListener('click', () => { ideaFilter = t; rerender(); });
    filterBar.appendChild(chip);
  });
  view.appendChild(filterBar);

  const list = DB.ideas.filter(i => ideaFilter === '전체' || i.type === ideaFilter);
  if (!list.length) {
    view.appendChild(el(`<div class="empty"><span class="empty-emoji">💡</span>${DB.ideas.length ? '해당 유형의 아이디어가 없어요.' : '아직 아이디어가 없어요.<br>첫 아이디어를 남겨보세요!'}</div>`));
    return;
  }

  const grid = el('<div class="idea-grid"></div>');
  // 핀 고정 우선 → 좋아요 많은 순
  [...list].sort((a, b) => (b.pinned - a.pinned) || ((b.likes || 0) - (a.likes || 0))).forEach(i => grid.appendChild(ideaCard(i)));
  view.appendChild(grid);
}

function ideaCard(i) {
  const color = IDEA_TYPES[i.type] || '#9a8f95';
  const card = el(`<div class="idea-card ${i.pinned ? 'pinned' : ''}" style="border-top-color:${color}">
    ${i.image ? `<img src="${esc(i.image)}" alt="" onerror="this.style.display='none'" />` : ''}
    <div class="idea-body">
      <div style="margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <span class="tag" style="background:${color};color:${textColorOn(color)}">${esc(i.type)}</span>
        ${i.pinned ? '<span class="tag tag-soft">📌 고정됨</span>' : ''}
      </div>
      <div class="idea-title">${esc(i.title)}</div>
      ${i.content ? `<div class="idea-content">${esc(i.content)}</div>` : ''}
      <div class="idea-foot">
        <button class="like-btn ${i.liked ? 'liked' : ''}" data-act="like">❤ <span>${i.likes || 0}</span></button>
        <button class="like-btn ${i.pinned ? 'liked' : ''}" data-act="pin" title="상단 고정">📌</button>
        <button class="btn btn-sm btn-icon" data-act="edit">편집</button>
        <button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button>
        <span class="idea-author">✍ ${esc(i.author)}</span>
      </div>
    </div>
  </div>`);
  $('[data-act=like]', card).addEventListener('click', () => {
    i.liked = !i.liked;
    i.likes = Math.max(0, (i.likes || 0) + (i.liked ? 1 : -1));
    saveDB(); rerender();
  });
  $('[data-act=pin]', card).addEventListener('click', () => {
    i.pinned = !i.pinned;
    saveDB(); rerender(); toast(i.pinned ? '상단에 고정했어요' : '고정을 해제했어요');
  });
  $('[data-act=edit]', card).addEventListener('click', () => openIdeaModal(i));
  $('[data-act=del]', card).addEventListener('click', () => confirmDelete(`'${i.title}' 아이디어를 삭제할까요?`, () => {
    DB.ideas = DB.ideas.filter(x => x.id !== i.id); saveDB(); rerender(); toast('삭제되었습니다');
  }));
  return card;
}

function openIdeaModal(existing) {
  const i = existing || { title: '', content: '', type: '오프라인 상영회', image: '', author: MEMBERS[0].name, likes: 0, pinned: false };
  const form = el(`
    <form id="ideaForm">
      <div class="field"><label>제목 <span class="req">*</span></label>
        <input type="text" name="title" value="${esc(i.title)}" required /></div>
      <div class="field"><label>내용</label>
        <textarea name="content" placeholder="아이디어/메모 내용">${esc(i.content)}</textarea></div>
      <div class="field"><label>유형 <span class="req">*</span></label>
        <div class="pill-select" id="typePick"></div></div>
      <div class="field"><label>이미지</label>
        <div class="seg" id="imgSeg" style="margin-bottom:8px">
          <button type="button" data-mode="url" class="active">URL 입력</button>
          <button type="button" data-mode="file">파일 업로드</button>
        </div>
        <input type="url" name="imageUrl" placeholder="https://..." value="${esc(i.image && !i.image.startsWith('data:') ? i.image : '')}" />
        <input type="file" name="imageFile" accept="image/*" style="display:none" />
        <div class="hint">파일 업로드 시 Base64로 저장됩니다 (용량 주의)</div>
        <div class="img-preview" id="imgPreview" ${i.image ? '' : 'hidden'}>${i.image ? `<img src="${esc(i.image)}" />` : ''}</div>
      </div>
      <div class="field"><label>작성자 <span class="req">*</span></label>
        <div class="pill-select" id="authorPick"></div></div>
    </form>`);

  const getType = pillSelect($('#typePick', form), Object.entries(IDEA_TYPES), i.type);
  const getAuthor = pillSelect($('#authorPick', form), MEMBERS.map(m => [m.name, m.color]), i.author);

  let imageData = i.image || '';
  const urlInput = form.querySelector('[name=imageUrl]');
  const fileInput = form.querySelector('[name=imageFile]');
  const preview = $('#imgPreview', form);
  const setPreview = (src) => {
    if (src) { preview.hidden = false; preview.innerHTML = `<img src="${esc(src)}" onerror="this.parentElement.hidden=true" />`; }
    else { preview.hidden = true; preview.innerHTML = ''; }
  };
  $('#imgSeg', form).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    $('#imgSeg', form).querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const mode = b.dataset.mode;
    urlInput.style.display = mode === 'url' ? '' : 'none';
    fileInput.style.display = mode === 'file' ? '' : 'none';
  }));
  urlInput.addEventListener('input', () => { imageData = urlInput.value.trim(); setPreview(imageData); });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 1.5 * 1024 * 1024) { toast('이미지는 1.5MB 이하만 업로드해주세요'); fileInput.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { imageData = reader.result; setPreview(imageData); };
    reader.readAsDataURL(f);
  });

  const footer = [];
  if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => confirmDelete(`'${i.title}'을(를) 삭제할까요?`, () => {
    DB.ideas = DB.ideas.filter(x => x.id !== i.id); saveDB(); closeModal(); rerender(); toast('삭제되었습니다');
  })));
  footer.push(mkBtn('취소', 'btn-ghost', closeModal));
  footer.push(mkBtn(existing ? '저장' : '추가', 'btn-primary', () => {
    const title = form.querySelector('[name=title]').value.trim();
    if (!title) return toast('제목을 입력해주세요');
    const data = { title, content: form.querySelector('[name=content]').value.trim(), type: getType(), image: imageData, author: getAuthor() };
    if (existing) Object.assign(existing, data);
    else DB.ideas.push({ id: uid(), likes: 0, liked: false, pinned: false, ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '아이디어가 추가되었습니다');
  }));

  openModal({ title: existing ? '아이디어 편집' : '아이디어 추가', body: form, footer });
}

/* =========================================================
   F4. 회계 시트 (수입/지출)
   ========================================================= */
let accCharts = { donut: null, bar: null };

function accStats() {
  const income = DB.accounting.filter(a => a.type === '수입').reduce((s, a) => s + Number(a.amount || 0), 0);
  const expense = DB.accounting.filter(a => a.type === '지출').reduce((s, a) => s + Number(a.amount || 0), 0);
  const budget = Number(DB.budget || 0);
  const balance = budget - expense + income;
  return { income, expense, budget, balance };
}
function accGroupColor(a) {
  return (a.type === '수입' ? INCOME_GROUP_COLORS : EXPENSE_GROUP_COLORS)[a.group] || '#9a8f95';
}

function renderAccounting() {
  addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportAccounting()));
  addTopbarAction(mkBtn('버짓 설정', 'btn-sm', () => openBudgetModal()));
  addTopbarAction(mkBtn('+ 내역', 'btn-sm btn-primary', () => openAccModal(null)));

  const view = $('#view');
  const { income, expense, budget, balance } = accStats();
  const rate = budget > 0 ? Math.min(100, Math.round(expense / budget * 100)) : 0;

  const summary = el(`<div class="summary-cards">
    <div class="card sum-card">
      <div class="sum-label">총 버짓</div>
      <div class="sum-value">${won(budget)}</div>
      <div class="progress"><div class="progress-fill" style="width:${rate}%"></div></div>
      <div class="sum-sub">사용률 ${rate}% · 잔액 ${won(balance)}</div>
    </div>
    <div class="card sum-card">
      <div class="sum-label">지출 합계</div>
      <div class="sum-value neg">${won(expense)}</div>
      <div class="sum-sub">전체 지출</div>
    </div>
    <div class="card sum-card">
      <div class="sum-label">수입 합계</div>
      <div class="sum-value pos">${won(income)}</div>
      <div class="sum-sub">고유목적사업 · 수익사업 · 영업외</div>
    </div>
  </div>`);
  view.appendChild(summary);

  const charts = el(`<div class="charts">
    <div class="card chart-card"><h4>분류별 지출 비중</h4><div class="chart-wrap"><canvas id="donutChart"></canvas></div></div>
    <div class="card chart-card"><h4>월별 수입/지출 추이</h4><div class="chart-wrap"><canvas id="barChart"></canvas></div></div>
  </div>`);
  view.appendChild(charts);

  if (!DB.accounting.length) {
    view.appendChild(el(`<div class="empty"><span class="empty-emoji">💰</span>아직 수입/지출 내역이 없어요.<br>우측 상단 <b>+ 내역</b>으로 추가해보세요.</div>`));
  } else {
    const scroll = el('<div class="table-scroll"></div>');
    const table = el(`<table class="data">
      <thead><tr><th>날짜</th><th>유형</th><th>구분</th><th>항목</th><th>내용</th><th style="text-align:center">인원<br>/수량</th><th style="text-align:center">개월<br>/횟수</th><th style="text-align:right">단가</th><th style="text-align:right">금액</th><th></th></tr></thead>
      <tbody></tbody></table>`);
    const tb = $('tbody', table);
    [...DB.accounting].sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(a => {
      const col = accGroupColor(a);
      const isIn = a.type === '수입';
      const tr = el(`<tr>
        <td>${fmtDate(a.date)}</td>
        <td><span class="tag" style="background:${isIn ? 'var(--p4)' : 'var(--p3)'};color:#fff">${a.type}</span></td>
        <td><span class="tag" style="background:${col};color:${textColorOn(col)}">${esc(a.group)}</span></td>
        <td>${esc(a.account)}</td>
        <td style="color:var(--muted)">${esc(a.content || '')}</td>
        <td style="text-align:center">${comma(a.qty ?? 1)}</td>
        <td style="text-align:center">${comma(a.times ?? 1)}</td>
        <td class="amt">${comma(a.unit ?? 0)}</td>
        <td class="amt ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${comma(a.amount)}</td>
        <td><div class="row-actions"><button class="btn btn-sm btn-icon" data-act="edit">편집</button><button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button></div></td>
      </tr>`);
      $('[data-act=edit]', tr).addEventListener('click', () => openAccModal(a));
      $('[data-act=del]', tr).addEventListener('click', () => confirmDelete(`'${a.content || a.account}' 내역을 삭제할까요?`, () => {
        DB.accounting = DB.accounting.filter(x => x.id !== a.id); saveDB(); rerender(); toast('삭제되었습니다');
      }));
      tb.appendChild(tr);
    });
    scroll.appendChild(table);
    view.appendChild(scroll);
  }

  drawAccCharts();
}

function drawAccCharts() {
  if (accCharts.donut) { accCharts.donut.destroy(); accCharts.donut = null; }
  if (accCharts.bar) { accCharts.bar.destroy(); accCharts.bar = null; }
  if (typeof Chart === 'undefined') return;

  const byGroup = {};
  DB.accounting.filter(a => a.type === '지출').forEach(a => { byGroup[a.group] = (byGroup[a.group] || 0) + Number(a.amount || 0); });
  const cats = Object.keys(EXPENSE_GROUP_COLORS).filter(c => byGroup[c]);
  const donutCtx = $('#donutChart');
  if (donutCtx) {
    if (cats.length) {
      accCharts.donut = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: cats,
          datasets: [{ data: cats.map(c => byGroup[c]), backgroundColor: cats.map(c => EXPENSE_GROUP_COLORS[c]), borderWidth: 2, borderColor: '#fff' }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: {
            legend: { position: 'bottom', labels: { font: { family: "'Noto Sans KR'" }, padding: 10, boxWidth: 12 } },
            tooltip: { callbacks: { label: (c) => `${c.label}: ${won(c.raw)}` } },
          },
        },
      });
    } else emptyCanvas(donutCtx, '지출 내역 없음');
  }

  const barCtx = $('#barChart');
  if (barCtx) {
    const labels = MONTHS.map(m => `${m.m + 1}월`);
    const inData = MONTHS.map(() => 0), outData = MONTHS.map(() => 0);
    DB.accounting.forEach(a => {
      if (!a.date) return;
      const mm = Number(a.date.split('-')[1]) - 1;
      const idx = MONTHS.findIndex(m => m.m === mm);
      if (idx < 0) return;
      if (a.type === '수입') inData[idx] += Number(a.amount || 0);
      else outData[idx] += Number(a.amount || 0);
    });
    if (DB.accounting.length) {
      accCharts.bar = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels, datasets: [
            { label: '수입', data: inData, backgroundColor: '#31cc66', borderRadius: 5 },
            { label: '지출', data: outData, backgroundColor: '#ff7300', borderRadius: 5 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { font: { family: "'Noto Sans KR'" }, padding: 12, boxWidth: 12 } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${won(c.raw)}` } },
          },
          scales: { y: { beginAtZero: true, ticks: { callback: (v) => v >= 10000 ? (v / 10000) + '만' : comma(v) } } },
        },
      });
    } else emptyCanvas(barCtx, '내역 없음');
  }
}
function emptyCanvas(canvas, msg) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#9a8f95'; ctx.font = "14px 'Noto Sans KR'"; ctx.textAlign = 'center';
  ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
}

function openBudgetModal() {
  const form = el(`<form><div class="field"><label>총 버짓 (원)</label>
    <input type="text" name="budget" inputmode="numeric" value="${comma(DB.budget)}" />
    <div class="hint">프로젝트 전체 예산을 입력하세요.</div></div></form>`);
  const input = form.querySelector('[name=budget]');
  input.addEventListener('input', () => {
    const num = input.value.replace(/[^\d]/g, '');
    input.value = num ? comma(num) : '';
  });
  openModal({
    title: '총 버짓 설정', body: form,
    footer: [
      mkBtn('취소', 'btn-ghost', closeModal),
      mkBtn('저장', 'btn-primary', () => {
        DB.budget = Number(input.value.replace(/[^\d]/g, '') || 0);
        saveDB(); closeModal(); rerender(); toast('버짓이 설정되었습니다');
      }),
    ],
  });
}

function openAccModal(existing) {
  const a = existing || { type: '지출', group: '운영비', account: '대관', content: '', qty: 1, times: 1, unit: '', amount: 0, date: todayStr() };
  const form = el(`
    <form id="accForm">
      <div class="field"><label>유형 <span class="req">*</span></label>
        <div class="seg" id="typeSeg">
          <button type="button" data-v="수입" class="${a.type === '수입' ? 'active' : ''}">수입</button>
          <button type="button" data-v="지출" class="${a.type === '지출' ? 'active' : ''}">지출</button>
        </div></div>
      <div class="field-row">
        <div class="field"><label>구분 <span class="req">*</span></label>
          <select name="group" id="accGroup"></select></div>
        <div class="field"><label>항목 <span class="req">*</span></label>
          <select name="account" id="accAccount"></select></div>
      </div>
      <div class="acc-hint" id="accHint" hidden></div>
      <div class="field"><label>내용</label>
        <input type="text" name="content" placeholder="예) 활동비, 회식(빅활동 팀원+연사) 등" value="${esc(a.content)}" /></div>
      <div class="field-row">
        <div class="field"><label>인원/수량 (A)</label>
          <input type="number" name="qty" inputmode="decimal" min="0" step="1" value="${a.qty ?? 1}" /></div>
        <div class="field"><label>개월/횟수 (B)</label>
          <input type="number" name="times" inputmode="decimal" min="0" step="1" value="${a.times ?? 1}" /></div>
        <div class="field"><label>단가 (C) <span class="req">*</span></label>
          <input type="text" name="unit" inputmode="numeric" placeholder="0" value="${a.unit ? comma(a.unit) : ''}" /></div>
      </div>
      <div class="amount-box">
        <label>금액 <span style="color:var(--muted);font-weight:400">(A × B × C 자동 계산)</span></label>
        <div class="amount-display" id="amountDisplay">₩0</div>
      </div>
      <div class="field"><label>날짜 <span class="req">*</span></label>
        <input type="date" name="date" value="${a.date}" required /></div>
    </form>`);

  let type = a.type;
  const groupSel = $('#accGroup', form);
  const accSel = $('#accAccount', form);
  const hintEl = $('#accHint', form);
  const qtyIn = form.querySelector('[name=qty]');
  const timesIn = form.querySelector('[name=times]');
  const unitIn = form.querySelector('[name=unit]');
  const amountDisp = $('#amountDisplay', form);

  const calcAmount = () => {
    const q = Number(qtyIn.value) || 0;
    const t = Number(timesIn.value) || 0;
    const u = Number(unitIn.value.replace(/[^\d]/g, '')) || 0;
    return Math.round(q * t * u);
  };
  const updateAmount = () => { amountDisp.textContent = won(calcAmount()); };

  const updateHint = () => {
    const hints = ACCOUNT_PRICE_HINTS[accSel.value];
    if (hints && hints.length) {
      hintEl.hidden = false;
      hintEl.innerHTML = '💡 <b>단가표</b> · ' + hints.map(esc).join(' &nbsp;/&nbsp; ');
    } else { hintEl.hidden = true; hintEl.innerHTML = ''; }
  };

  const fillAccounts = (group, selectedAcc) => {
    const struct = type === '수입' ? INCOME_STRUCTURE : EXPENSE_STRUCTURE;
    const accs = struct[group] || [];
    accSel.innerHTML = accs.map(x => `<option ${x === selectedAcc ? 'selected' : ''}>${esc(x)}</option>`).join('');
    updateHint();
  };
  const fillGroups = (selectedGroup, selectedAcc) => {
    const struct = type === '수입' ? INCOME_STRUCTURE : EXPENSE_STRUCTURE;
    const groups = Object.keys(struct);
    const g = struct[selectedGroup] ? selectedGroup : groups[0];
    groupSel.innerHTML = groups.map(x => `<option ${x === g ? 'selected' : ''}>${esc(x)}</option>`).join('');
    fillAccounts(g, selectedAcc);
  };

  $('#typeSeg', form).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    type = b.dataset.v;
    $('#typeSeg', form).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    fillGroups();
  }));
  groupSel.addEventListener('change', () => fillAccounts(groupSel.value));
  accSel.addEventListener('change', updateHint);
  fillGroups(a.group, a.account);

  unitIn.addEventListener('input', () => { const n = unitIn.value.replace(/[^\d]/g, ''); unitIn.value = n ? comma(n) : ''; updateAmount(); });
  qtyIn.addEventListener('input', updateAmount);
  timesIn.addEventListener('input', updateAmount);
  updateAmount();

  const footer = [];
  if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => confirmDelete(`'${a.content || a.account}' 내역을 삭제할까요?`, () => {
    DB.accounting = DB.accounting.filter(x => x.id !== a.id); saveDB(); closeModal(); rerender(); toast('삭제되었습니다');
  })));
  footer.push(mkBtn('취소', 'btn-ghost', closeModal));
  footer.push(mkBtn(existing ? '저장' : '추가', 'btn-primary', () => {
    const fd = new FormData(form);
    const amount = calcAmount();
    if (!amount) return toast('인원/수량 · 개월/횟수 · 단가를 입력해주세요');
    const data = {
      type, group: groupSel.value, account: accSel.value, content: fd.get('content').trim(),
      qty: Number(qtyIn.value) || 0, times: Number(timesIn.value) || 0,
      unit: Number(unitIn.value.replace(/[^\d]/g, '')) || 0, amount, date: fd.get('date'),
    };
    if (existing) Object.assign(existing, data);
    else DB.accounting.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '내역이 추가되었습니다');
  }));

  openModal({ title: existing ? '내역 편집' : '수입/지출 등록', body: form, footer });
}

/* =========================================================
   F5. 타임스탬프
   ========================================================= */
function renderTimestamps() {
  addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportTimestamps()));
  addTopbarAction(mkBtn('+ 기록', 'btn-sm btn-primary', () => openTsModal(null)));

  const view = $('#view');

  const totals = {};
  MEMBERS.forEach(m => totals[m.name] = 0);
  DB.timestamps.forEach(t => { totals[t.name] = (totals[t.name] || 0) + Number(t.hours || 0); });
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);
  const maxHours = Math.max(1, ...Object.values(totals));

  const summary = el('<div class="ts-summary"></div>');
  summary.appendChild(el(`<div class="card ts-total"><span class="sum-label">팀 전체 총 작업시간</span><span class="sum-value">${grandTotal}</span><span class="sum-label">시간</span></div>`));
  const members = el('<div class="ts-members"></div>');
  MEMBERS.forEach(m => {
    const h = totals[m.name] || 0;
    members.appendChild(el(`<div class="card ts-member">
      <div class="ts-member-top"><span class="tag-dot" style="background:${m.color}"></span><span class="ts-member-name">${m.name}</span></div>
      <div class="ts-member-hours">${h}<span style="font-size:13px;color:var(--muted);font-weight:400"> 시간</span></div>
      <div class="ts-bar"><div class="ts-bar-fill" style="width:${Math.round(h / maxHours * 100)}%;background:${m.color}"></div></div>
    </div>`));
  });
  summary.appendChild(members);
  view.appendChild(summary);

  if (!DB.timestamps.length) {
    view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏱️</span>아직 작업 기록이 없어요.<br>우측 상단 <b>+ 기록</b>으로 추가해보세요.</div>`));
    return;
  }

  const scroll = el('<div class="table-scroll"></div>');
  const table = el(`<table class="data">
    <thead><tr><th>날짜</th><th>이름</th><th style="text-align:right">시간</th><th>한 일</th><th></th></tr></thead>
    <tbody></tbody></table>`);
  const tb = $('tbody', table);
  [...DB.timestamps].sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(t => {
    const col = MEMBER_COLOR[t.name] || '#9a8f95';
    const tr = el(`<tr>
      <td>${fmtDate(t.date)}</td>
      <td><span class="tag" style="background:${col};color:${textColorOn(col)}">${esc(t.name)}</span></td>
      <td class="amt">${t.hours}h</td>
      <td>${esc(t.work)}</td>
      <td><div class="row-actions"><button class="btn btn-sm btn-icon" data-act="edit">편집</button><button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button></div></td>
    </tr>`);
    $('[data-act=edit]', tr).addEventListener('click', () => openTsModal(t));
    $('[data-act=del]', tr).addEventListener('click', () => confirmDelete('이 기록을 삭제할까요?', () => {
      DB.timestamps = DB.timestamps.filter(x => x.id !== t.id); saveDB(); rerender(); toast('삭제되었습니다');
    }));
    tb.appendChild(tr);
  });
  scroll.appendChild(table);
  view.appendChild(scroll);
}

function openTsModal(existing, defaultDate) {
  const t = existing || { name: MEMBERS[0].name, date: defaultDate || todayStr(), hours: '', work: '' };
  const form = el(`
    <form id="tsForm">
      <div class="field"><label>이름 <span class="req">*</span></label>
        <div class="pill-select" id="tsNamePick"></div></div>
      <div class="field-row">
        <div class="field"><label>날짜 <span class="req">*</span></label>
          <input type="date" name="date" value="${t.date}" required /></div>
        <div class="field"><label>시간 <span class="req">*</span></label>
          <input type="number" name="hours" step="0.5" min="0" placeholder="예) 2.5" value="${t.hours}" required /></div>
      </div>
      <div class="field"><label>한 일 <span class="req">*</span></label>
        <input type="text" name="work" placeholder="예) 영화관 3곳 컨택" value="${esc(t.work)}" required /></div>
    </form>`);

  const getName = pillSelect($('#tsNamePick', form), MEMBERS.map(m => [m.name, m.color]), t.name);

  const footer = [];
  if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => confirmDelete('이 기록을 삭제할까요?', () => {
    DB.timestamps = DB.timestamps.filter(x => x.id !== t.id); saveDB(); closeModal(); rerender(); toast('삭제되었습니다');
  })));
  footer.push(mkBtn('취소', 'btn-ghost', closeModal));
  footer.push(mkBtn(existing ? '저장' : '추가', 'btn-primary', () => {
    const fd = new FormData(form);
    const hours = Number(fd.get('hours'));
    const work = fd.get('work').trim();
    if (!hours || hours <= 0) return toast('시간을 입력해주세요');
    if (!work) return toast('한 일을 입력해주세요');
    const data = { name: getName(), date: fd.get('date'), hours, work };
    if (existing) Object.assign(existing, data);
    else DB.timestamps.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '기록이 추가되었습니다');
  }));

  openModal({ title: existing ? '기록 편집' : '작업 기록 추가', body: form, footer });
}

/* =========================================================
   F6. 회의록
   ========================================================= */
function renderMinutes() {
  addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportMinutes()));
  addTopbarAction(mkBtn('+ 회의록', 'btn-sm btn-primary', () => openMinuteModal(null)));

  const view = $('#view');

  if (!DB.minutes.length) {
    view.appendChild(el(`<div class="empty"><span class="empty-emoji">📝</span>아직 회의록이 없어요.<br>우측 상단 <b>+ 회의록</b>으로 첫 회의를 기록해보세요.</div>`));
    return;
  }

  const list = el('<div></div>');
  [...DB.minutes].sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(m => list.appendChild(minuteCard(m)));
  view.appendChild(list);
}

function minuteCard(m) {
  const people = [
    ...m.participants.map(p => {
      const col = MEMBER_COLOR[p] || '#9a8f95';
      return `<span class="tag" style="background:${col};color:${textColorOn(col)}">${esc(p)}</span>`;
    }),
    ...m.guests.map(g => `<span class="tag tag-soft">👤 ${esc(g)}</span>`),
  ].join('');
  const preview = [m.purpose && `목적: ${m.purpose}`, m.content].filter(Boolean).join(' · ');

  const card = el(`<div class="card minute-card">
    <div class="minute-head">
      <div>
        <div class="minute-title">${esc(m.title)}</div>
        <div class="minute-date">🗓 ${fmtDate(m.date)} (${weekdayKo(m.date)})${m.nextDate ? ` · 다음 미팅 ${fmtDate(m.nextDate)}` : ''}</div>
      </div>
    </div>
    <div class="minute-people">${people}</div>
    ${preview ? `<div class="minute-preview">${esc(preview)}</div>` : ''}
    <div class="minute-foot">
      <button class="btn btn-sm" data-act="doc">📄 워드 다운로드</button>
      <button class="btn btn-sm btn-icon" data-act="edit">편집</button>
      <button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button>
    </div>
  </div>`);
  card.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    openMinuteDetail(m);
  });
  $('[data-act=doc]', card).addEventListener('click', () => downloadMinuteDoc(m));
  $('[data-act=edit]', card).addEventListener('click', () => openMinuteModal(m));
  $('[data-act=del]', card).addEventListener('click', () => confirmDelete(`'${m.title}' 회의록을 삭제할까요?`, () => {
    DB.minutes = DB.minutes.filter(x => x.id !== m.id); saveDB(); rerender(); toast('삭제되었습니다');
  }));
  return card;
}

function openMinuteDetail(m) {
  const people = [...m.participants, ...m.guests.map(g => `${g}(게스트)`)].join(', ');
  const body = el(`<div>
    <div class="detail-row"><span class="dk">날짜</span><span class="dv">${fmtDate(m.date)} (${weekdayKo(m.date)})</span></div>
    <div class="detail-row"><span class="dk">참가자</span><span class="dv">${esc(people) || '-'}</span></div>
    ${m.purpose ? `<div class="detail-row"><span class="dk">회의 목적</span><span class="dv" style="white-space:pre-wrap">${esc(m.purpose)}</span></div>` : ''}
    ${m.content ? `<div class="detail-row"><span class="dk">회의 내용</span><span class="dv" style="white-space:pre-wrap">${esc(m.content)}</span></div>` : ''}
    ${m.nextAgenda ? `<div class="detail-row"><span class="dk">다음 안건</span><span class="dv" style="white-space:pre-wrap">${esc(m.nextAgenda)}</span></div>` : ''}
    ${m.nextDate ? `<div class="detail-row"><span class="dk">다음 미팅</span><span class="dv">${fmtDate(m.nextDate)} (${weekdayKo(m.nextDate)})</span></div>` : ''}
  </div>`);
  openModal({
    title: m.title, body,
    footer: [
      mkBtn('📄 워드', 'btn-ghost', () => downloadMinuteDoc(m)),
      mkBtn('닫기', 'btn-ghost', closeModal),
      mkBtn('편집', 'btn-primary', () => { closeModal(); openMinuteModal(m); }),
    ],
  });
}

function openMinuteModal(existing) {
  const m = existing || { title: '', date: todayStr(), participants: [], guests: [], purpose: '', content: '', nextAgenda: '', nextDate: '' };
  let guests = [...(m.guests || [])];

  const form = el(`
    <form id="minuteForm">
      <div class="field"><label>1. 제목 <span class="req">*</span></label>
        <input type="text" name="title" placeholder="예) 7월 정기회의" value="${esc(m.title)}" required /></div>
      <div class="field"><label>날짜 <span class="req">*</span></label>
        <input type="date" name="date" value="${m.date}" required /></div>
      <div class="field"><label>2. 참가자 <span class="req">*</span> <span style="color:var(--muted);font-weight:400">(복수 선택)</span></label>
        <div class="pill-select" id="participantsPick"></div>
        <div class="field-row" style="margin-top:10px">
          <div class="field" style="margin:0;flex:1.6"><input type="text" id="guestInput" placeholder="게스트 이름 입력" /></div>
          <div class="field" style="margin:0"><button type="button" class="btn btn-block" id="addGuestBtn">+ 게스트 추가</button></div>
        </div>
        <div class="chips" id="guestChips"></div>
      </div>
      <div class="field"><label>3. 회의 목적</label>
        <input type="text" name="purpose" placeholder="예) 상영회 장소 확정" value="${esc(m.purpose)}" /></div>
      <div class="field"><label>회의 내용 <span style="color:var(--muted);font-weight:400">(프로그램, 아이디어 등)</span></label>
        <textarea name="content" placeholder="논의된 내용을 기록하세요" style="min-height:120px">${esc(m.content)}</textarea></div>
      <div class="field"><label>4. 다음 회의 안건</label>
        <textarea name="nextAgenda" placeholder="다음 회의에서 다룰 안건">${esc(m.nextAgenda)}</textarea></div>
      <div class="field"><label>다음 미팅 날짜</label>
        <input type="date" name="nextDate" value="${m.nextDate || ''}" /></div>
    </form>`);

  const getParticipants = pillMultiSelect($('#participantsPick', form), MEMBERS.map(x => [x.name, x.color]), m.participants);

  const guestChips = $('#guestChips', form);
  const guestInput = $('#guestInput', form);
  const drawGuests = () => {
    guestChips.innerHTML = '';
    guests.forEach(g => {
      const chip = el(`<span class="chip-item">👤 ${esc(g)} <button type="button" aria-label="삭제">✕</button></span>`);
      chip.querySelector('button').addEventListener('click', () => { guests = guests.filter(x => x !== g); drawGuests(); });
      guestChips.appendChild(chip);
    });
  };
  drawGuests();
  const addGuest = () => {
    const v = guestInput.value.trim();
    if (!v) return toast('게스트 이름을 입력해주세요');
    if (guests.includes(v)) return toast('이미 추가된 게스트예요');
    guests.push(v);
    guestInput.value = '';
    drawGuests();
  };
  $('#addGuestBtn', form).addEventListener('click', addGuest);
  guestInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } });

  const footer = [];
  if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => confirmDelete(`'${m.title}' 회의록을 삭제할까요?`, () => {
    DB.minutes = DB.minutes.filter(x => x.id !== m.id); saveDB(); closeModal(); rerender(); toast('삭제되었습니다');
  })));
  footer.push(mkBtn('취소', 'btn-ghost', closeModal));
  footer.push(mkBtn(existing ? '저장' : '추가', 'btn-primary', () => {
    const fd = new FormData(form);
    const title = fd.get('title').trim();
    if (!title) return toast('제목을 입력해주세요');
    const participants = getParticipants();
    // 입력창에 남은 게스트도 반영
    const pendingGuest = guestInput.value.trim();
    if (pendingGuest && !guests.includes(pendingGuest)) guests.push(pendingGuest);
    if (!participants.length && !guests.length) return toast('참가자를 1명 이상 선택해주세요');
    const data = {
      title, date: fd.get('date'), participants, guests: [...guests],
      purpose: fd.get('purpose').trim(), content: fd.get('content').trim(),
      nextAgenda: fd.get('nextAgenda').trim(), nextDate: fd.get('nextDate'),
    };
    if (existing) Object.assign(existing, data);
    else DB.minutes.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '회의록이 추가되었습니다');
  }));

  openModal({ title: existing ? '회의록 편집' : '회의록 작성', body: form, footer });
}

/* 회의록 → 워드(.doc) 다운로드 */
function downloadMinuteDoc(m) {
  const people = [
    ...m.participants,
    ...m.guests.map(g => `${g} (게스트)`),
  ].map(p => `<li>${esc(p)}</li>`).join('');

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(m.title)}</title>
<style>
  body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; color: #180f14; line-height: 1.7; }
  h1 { font-size: 22pt; border-bottom: 2px solid #180f14; padding-bottom: 8pt; }
  h2 { font-size: 13pt; margin-top: 18pt; color: #180f14; }
  table { border-collapse: collapse; width: 100%; margin: 12pt 0; }
  td { border: 1px solid #ccc; padding: 6pt 10pt; font-size: 10.5pt; }
  td.k { background: #f5f0ed; font-weight: bold; width: 110pt; }
  ul { margin: 4pt 0; }
  p { font-size: 10.5pt; white-space: pre-wrap; }
  .footer { margin-top: 24pt; font-size: 9pt; color: #888; }
</style></head>
<body>
  <h1>📝 ${esc(m.title)}</h1>
  <table>
    <tr><td class="k">회의 날짜</td><td>${fmtDate(m.date)} (${weekdayKo(m.date)})</td></tr>
    <tr><td class="k">다음 미팅 날짜</td><td>${m.nextDate ? `${fmtDate(m.nextDate)} (${weekdayKo(m.nextDate)})` : '-'}</td></tr>
  </table>
  <h2>1. 참가자</h2>
  <ul>${people || '<li>-</li>'}</ul>
  <h2>2. 회의 목적</h2>
  <p>${nl2br(m.purpose || '-')}</p>
  <h2>3. 회의 내용</h2>
  <p>${nl2br(m.content || '-')}</p>
  <h2>4. 다음 회의 안건</h2>
  <p>${nl2br(m.nextAgenda || '-')}</p>
  <div class="footer">빅활동: 민활기 다큐 상영회 — 회의록 · 생성일 ${fmtDate(todayStr())}</div>
</body></html>`;

  const blob = new Blob(['﻿' + html], { type: 'application/msword' });
  const a = document.createElement('a');
  const safeTitle = m.title.replace(/[\\/:*?"<>|]/g, '_');
  a.href = URL.createObjectURL(blob);
  a.download = `회의록_${safeTitle}_${(m.date || '').replaceAll('-', '')}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('워드 파일을 다운로드했어요');
}

/* =========================================================
   엑셀 백업 (SheetJS) + JSON 백업/복원
   ========================================================= */
function fileName(menu) { return `빅활동_${menu}_${stampToday()}.xlsx`; }
function sheetFrom(rows) { return XLSX.utils.json_to_sheet(rows.length ? rows : [{}]); }

function eventsRows() {
  return [...DB.events].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => ({
    날짜: e.date, 종료일: e.dateEnd || '', 시간: e.time || '종일', 이벤트명: e.name, 섹터: e.sector, 메모: e.memo || '',
  }));
}
function cinemasRows() {
  return DB.cinemas.map(c => ({
    지역: c.region, 영화관: c.name, 위치: c.location, 상태: c.status,
    상영일정: (c.dates || []).join(', '), 담당자: c.manager || '', 연락처: c.contact || '', 메모: c.memo || '',
  }));
}
function ideasRows() {
  return DB.ideas.map(i => ({
    제목: i.title, 유형: i.type, 내용: i.content || '', 작성자: i.author, 좋아요: i.likes || 0,
    고정: i.pinned ? '예' : '',
    이미지: i.image && i.image.startsWith('data:') ? '(업로드 이미지)' : (i.image || ''),
  }));
}
function accountingRows() {
  return [...DB.accounting].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(a => ({
    날짜: a.date, 유형: a.type, 구분: a.group, 항목: a.account, 내용: a.content || '',
    '인원/수량': Number(a.qty ?? 1), '개월/횟수': Number(a.times ?? 1), 단가: Number(a.unit ?? 0), 금액: Number(a.amount || 0),
  }));
}
function timestampsRows() {
  return [...DB.timestamps].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(t => ({
    날짜: t.date, 이름: t.name, 시간: t.hours, 한일: t.work,
  }));
}
function minutesRows() {
  return [...DB.minutes].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(m => ({
    날짜: m.date, 제목: m.title, 참가자: m.participants.join(', '), 게스트: m.guests.join(', '),
    회의목적: m.purpose || '', 회의내용: m.content || '', 다음회의안건: m.nextAgenda || '', 다음미팅날짜: m.nextDate || '',
  }));
}
function settingsRows() {
  return [{ 항목: '총 버짓', 값: Number(DB.budget || 0) }];
}

function downloadSheet(rows, menu, sheetName) {
  if (!rows.length) return toast('내보낼 데이터가 없어요');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(rows), sheetName);
  XLSX.writeFile(wb, fileName(menu));
  toast('엑셀 파일을 다운로드했어요');
}

function exportCalendar() { downloadSheet(eventsRows(), '캘린더', '캘린더'); }
function exportCinemas() { downloadSheet(cinemasRows(), '영화관리스트', '영화관'); }
function exportIdeas() { downloadSheet(ideasRows(), '아이디어메모', '아이디어'); }
function exportMinutes() { downloadSheet(minutesRows(), '회의록', '회의록'); }
function exportAccounting() {
  const rows = accountingRows();
  if (!rows.length) return toast('내보낼 데이터가 없어요');
  const { income, expense, budget, balance } = accStats();
  rows.push({}, { 날짜: '요약', 구분: '총 버짓', 금액: budget });
  rows.push({ 날짜: '', 구분: '지출 합계', 금액: expense });
  rows.push({ 날짜: '', 구분: '수입 합계', 금액: income });
  rows.push({ 날짜: '', 구분: '잔액', 금액: balance });
  downloadSheet(rows, '회계시트', '회계');
}
function exportTimestamps() {
  const rows = timestampsRows();
  if (!rows.length) return toast('내보낼 데이터가 없어요');
  const totals = {};
  DB.timestamps.forEach(t => totals[t.name] = (totals[t.name] || 0) + Number(t.hours || 0));
  rows.push({});
  Object.entries(totals).forEach(([n, h]) => rows.push({ 날짜: '합계', 이름: n, 시간: h, 한일: '' }));
  downloadSheet(rows, '타임스탬프', '타임스탬프');
}

function exportAll() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(eventsRows()), '캘린더');
  XLSX.utils.book_append_sheet(wb, sheetFrom(cinemasRows()), '영화관');
  XLSX.utils.book_append_sheet(wb, sheetFrom(ideasRows()), '아이디어');
  XLSX.utils.book_append_sheet(wb, sheetFrom(accountingRows()), '회계');
  XLSX.utils.book_append_sheet(wb, sheetFrom(timestampsRows()), '타임스탬프');
  XLSX.utils.book_append_sheet(wb, sheetFrom(minutesRows()), '회의록');
  XLSX.utils.book_append_sheet(wb, sheetFrom(settingsRows()), '설정');
  XLSX.writeFile(wb, `빅활동_전체백업_${stampToday()}.xlsx`);
  toast('전체 데이터를 엑셀로 백업했어요');
}

/* JSON 백업 — 이미지 포함 무손실. 앱 업데이트/기기 이동 시 이 파일로 복원 */
function exportJSON() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `빅활동_백업_${stampToday()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('백업 파일(.json)을 저장했어요');
}

/* ---------- 백업 불러오기 ---------- */
function normDateCell(v) {
  if (v == null || v === '' || v === '종일') return '';
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : '';
  }
  const s = String(v).trim().replace(/[./]/g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : '';
}
function normNum(v) { return Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0; }

function dbFromWorkbook(wb) {
  const sheet = (names) => {
    for (const n of names) {
      if (wb.Sheets[n]) return XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
    }
    return [];
  };
  const db = structuredClone(DEFAULT_DB);
  db.seeded = true;

  sheet(['캘린더']).forEach(r => {
    const date = normDateCell(r['날짜']);
    if (!date || !r['이벤트명']) return;
    db.events.push({
      id: uid(), name: String(r['이벤트명']), sector: SECTORS[r['섹터']] ? r['섹터'] : '기타',
      date, dateEnd: normDateCell(r['종료일']),
      time: r['시간'] && r['시간'] !== '종일' ? String(r['시간']) : '', memo: String(r['메모'] || ''),
    });
  });
  sheet(['영화관']).forEach(r => {
    if (!r['영화관']) return;
    db.cinemas.push({
      id: uid(), name: String(r['영화관']), location: String(r['위치'] || ''),
      region: REGIONS.includes(r['지역']) ? r['지역'] : '서울',
      status: CINEMA_STATUS[r['상태']] ? r['상태'] : '확인중',
      dates: String(r['상영일정'] || '').split(',').map(s => normDateCell(s.trim())).filter(Boolean),
      manager: String(r['담당자'] || ''), contact: String(r['연락처'] || ''), memo: String(r['메모'] || ''),
    });
  });
  sheet(['아이디어']).forEach(r => {
    if (!r['제목']) return;
    const img = String(r['이미지'] || '');
    db.ideas.push({
      id: uid(), title: String(r['제목']), type: IDEA_TYPES[r['유형']] ? r['유형'] : '기타',
      content: String(r['내용'] || ''), author: String(r['작성자'] || MEMBERS[0].name),
      likes: normNum(r['좋아요']), liked: false, pinned: r['고정'] === '예',
      image: img === '(업로드 이미지)' ? '' : img,
    });
  });
  sheet(['회계']).forEach(r => {
    const date = normDateCell(r['날짜']);
    const type0 = String(r['유형'] || '');
    if (!date || !type0) return; // 요약 행 제외
    const type = type0 === '입금' ? '수입' : type0 === '출금' ? '지출' : type0;
    if (type !== '수입' && type !== '지출') return;
    const struct = type === '수입' ? INCOME_STRUCTURE : EXPENSE_STRUCTURE;
    // 구분(신규) / 분류(직전 버전), 항목(신규) / 계정과목(직전 버전)
    let group = String(r['구분'] ?? r['분류'] ?? '').trim();
    let account = String(r['항목'] ?? r['계정과목'] ?? '').trim();
    let content = String(r['내용'] || '');
    if (!(group && struct[group] && account && struct[group].includes(account))) {
      // 구버전: '항목'이 자유텍스트일 수 있음 → 내용으로 보존 후 매핑
      if (account && r['계정과목'] === undefined) content = [account, content].filter(Boolean).join(' / ');
      [group, account] = mapLegacyAccount(type, (r['구분'] ?? r['분류'] ?? '').toString() || account);
    }
    const qty = r['인원/수량'] !== undefined ? normNum(r['인원/수량']) : 1;
    const times = r['개월/횟수'] !== undefined ? normNum(r['개월/횟수']) : 1;
    let unit = r['단가'] !== undefined ? normNum(r['단가']) : 0;
    let amount = normNum(r['금액']);
    if (!unit && amount) unit = amount; // 구버전: 금액만 존재 → 단가로
    const calc = (qty || 0) * (times || 0) * (unit || 0);
    amount = calc || amount;
    db.accounting.push({
      id: uid(), type, group, account, content,
      qty: qty || 1, times: times || 1, unit, amount, date,
    });
  });
  sheet(['타임스탬프']).forEach(r => {
    const date = normDateCell(r['날짜']);
    if (!date || !r['이름']) return; // 합계 행 제외
    db.timestamps.push({
      id: uid(), name: String(r['이름']), date, hours: normNum(r['시간']), work: String(r['한일'] || ''),
    });
  });
  sheet(['회의록']).forEach(r => {
    const date = normDateCell(r['날짜']);
    if (!date || !r['제목']) return;
    db.minutes.push({
      id: uid(), title: String(r['제목']), date,
      participants: String(r['참가자'] || '').split(',').map(s => s.trim()).filter(Boolean),
      guests: String(r['게스트'] || '').split(',').map(s => s.trim()).filter(Boolean),
      purpose: String(r['회의목적'] || ''), content: String(r['회의내용'] || ''),
      nextAgenda: String(r['다음회의안건'] || ''), nextDate: normDateCell(r['다음미팅날짜']),
    });
  });
  sheet(['설정']).forEach(r => {
    if (r['항목'] === '총 버짓') db.budget = normNum(r['값']);
  });
  return db;
}

function handleImportFile(file) {
  const isJson = /\.json$/i.test(file.name);
  const reader = new FileReader();
  reader.onerror = () => toast('파일을 읽지 못했어요');
  reader.onload = () => {
    let newDB;
    try {
      if (isJson) {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object' || !('events' in parsed || 'accounting' in parsed)) {
          return toast('빅활동 백업 파일이 아니에요');
        }
        newDB = migrateDB({ ...structuredClone(DEFAULT_DB), ...parsed, seeded: true });
      } else {
        const wb = XLSX.read(reader.result, { type: 'array' });
        newDB = migrateDB(dbFromWorkbook(wb));
      }
    } catch (e) {
      console.error(e);
      return toast('백업 파일을 해석하지 못했어요');
    }
    const counts = `이벤트 ${newDB.events.length} · 영화관 ${newDB.cinemas.length} · 아이디어 ${newDB.ideas.length} · 회계 ${newDB.accounting.length} · 작업기록 ${newDB.timestamps.length} · 회의록 ${newDB.minutes.length}`;
    openModal({
      title: '백업 불러오기',
      body: el(`<div><p style="padding:4px 0;font-size:14.5px;line-height:1.7">백업 파일의 데이터로 <b>현재 데이터를 교체</b>합니다.</p>
        <p class="hint" style="margin-top:6px">${counts}</p>
        <p class="hint" style="margin-top:6px">진행 전에 현재 데이터를 백업해두면 안전해요.</p></div>`),
      footer: [
        mkBtn('취소', 'btn-ghost', closeModal),
        mkBtn('교체하고 불러오기', 'btn-primary', () => {
          DB = newDB;
          saveDB();
          closeModal();
          rerender();
          toast('백업 데이터를 불러왔어요');
        }),
      ],
    });
  };
  if (isJson) reader.readAsText(file);
  else reader.readAsArrayBuffer(file);
}

/* 백업 · 복원 통합 모달 */
function openDataModal() {
  const cloudInfo = cloudEnabled()
    ? '<p class="hint" style="margin-bottom:4px">☁️ <b>클라우드 동기화 사용 중</b> — 모든 기기·팀원이 같은 데이터를 봅니다. 백업 파일은 만약을 위한 보관용입니다.</p>'
    : '<p class="hint" style="margin-bottom:4px">💻 <b>로컬 모드</b> — 데이터가 이 브라우저에만 저장됩니다. 다른 기기·팀원과 공유하려면 백업 파일을 주고받거나, app.js에 Supabase 키를 설정해 클라우드 동기화를 켜세요.</p>';
  const body = el(`<div class="stack">
    ${cloudInfo}
    <button class="btn btn-block" id="dmJson">💾 백업 파일 저장 (.json) — 이미지 포함 무손실</button>
    <button class="btn btn-block" id="dmXlsx">📦 전체 엑셀 백업 (.xlsx) — 열람·공유용</button>
    <button class="btn btn-block btn-primary" id="dmImport">📥 백업 불러오기 (.json / .xlsx)</button>
    <p class="hint">앱을 새로 배포하거나 다른 기기로 옮길 때, 백업 파일을 저장한 뒤 새 앱에서 <b>백업 불러오기</b>를 하면 이전 데이터가 그대로 복원됩니다.</p>
  </div>`);
  body.querySelector('#dmJson').addEventListener('click', () => { exportJSON(); });
  body.querySelector('#dmXlsx').addEventListener('click', () => { exportAll(); });
  body.querySelector('#dmImport').addEventListener('click', () => {
    closeModal();
    $('#importFile').click();
  });
  openModal({
    title: '백업 · 복원',
    body,
    footer: [mkBtn('닫기', 'btn-ghost', closeModal)],
  });
}

/* =========================================================
   초기화
   ========================================================= */
function init() {
  document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#backupAllBtn').addEventListener('click', openDataModal);
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalRoot').hidden) closeModal(); });
  $('#importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) handleImportFile(f);
    e.target.value = ''; // 같은 파일 재선택 허용
  });

  const t = todayStr();
  const idx = MONTHS.findIndex(m => t.startsWith(`${m.y}-${pad(m.m + 1)}`));
  if (idx >= 0) calIndex = idx;

  navigate('calendar');
  initCloud();
}

document.addEventListener('DOMContentLoaded', init);
