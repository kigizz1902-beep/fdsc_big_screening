/* =========================================================
   빅활동: 민활기 다큐 상영회 — 협업 웹앱
   localStorage 기반 경량 SPA
   ========================================================= */

/* ---------- 상수 ---------- */
const MEMBERS = [
  { name: '도은', color: '#fece00' },
  { name: '가현', color: '#fea1cd' },
  { name: '상아', color: '#ff7300' },
  { name: '윤서', color: '#31cc66' },
  { name: '서린', color: '#00a3fe' },
  { name: '설향', color: '#fea501' },
];
const MEMBER_COLOR = Object.fromEntries(MEMBERS.map(m => [m.name, m.color]));

const REGIONS = ['서울', '수도권', '충청', '강원', '경남', '경북', '전라', '전남', '제주'];

const SECTORS = {
  '미팅': '#00a3fe',
  '상영회': '#ff7300',
  '기타': '#31cc66',
};

const CINEMA_STATUS = {
  '확인중': '#fece00',
  '컨택완료': '#00a3fe',
  '상영일정': '#31cc66',
};

const IDEA_TYPES = {
  '오프라인 상영회': '#fea1cd',
  '온라인 상영회': '#00a3fe',
  '기타': '#fece00',
};

const ACC_CATEGORIES = {
  '인건비': '#fea1cd',
  '운영비': '#00a3fe',
  '제작비': '#ff7300',
  '대관비': '#31cc66',
  '기타': '#fece00',
};

const MONTHS = [ // 2026년 7~10월
  { y: 2026, m: 6 }, { y: 2026, m: 7 }, { y: 2026, m: 8 }, { y: 2026, m: 9 },
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
  events: [], cinemas: [], ideas: [], accounting: [], timestamps: [],
  budget: 0, seeded: false,
};

let DB = loadDB();

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return seedDB(structuredClone(DEFAULT_DB));
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_DB), ...parsed };
  } catch (e) {
    console.error('DB load 실패', e);
    return seedDB(structuredClone(DEFAULT_DB));
  }
}
function seedDB(db) {
  if (!db.seeded) {
    db.events = SEED_EVENTS.map(e => ({ id: uid(), time: '', ...e }));
    db.seeded = true;
  }
  return db;
}
function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  } catch (e) {
    if (String(e).includes('exceeded') || e.name === 'QuotaExceededError') {
      toast('저장 공간이 가득 찼어요. 이미지 용량을 줄여주세요.');
    } else {
      toast('저장에 실패했습니다.');
    }
    console.error(e);
  }
}

/* ---------- 유틸 ---------- */
function uid() { return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function $(sel, root = document) { return root.querySelector(sel); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function comma(n) { return Number(n || 0).toLocaleString('ko-KR'); }
function won(n) { return '₩' + comma(n); }
function stampToday() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; }
function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${y}.${m}.${d}`;
}
function textColorOn(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#180f14' : '#ffffff';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

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
function mkBtn(label, cls, onClick) {
  const b = el(`<button class="btn ${cls}">${label}</button>`);
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

/* ---------- 라우터 ---------- */
const VIEWS = {
  calendar: { title: '캘린더', render: renderCalendar },
  cinemas: { title: '영화관 리스트', render: renderCinemas },
  ideas: { title: '상영회 아이디어', render: renderIdeas },
  accounting: { title: '회계 시트', render: renderAccounting },
  timestamps: { title: '타임스탬프', render: renderTimestamps },
};
let currentView = 'calendar';

function navigate(view) {
  if (!VIEWS[view]) view = 'calendar';
  currentView = view;
  $('#pageTitle').textContent = VIEWS[view].title;
  document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#topbarActions').innerHTML = '';
  $('#view').innerHTML = '';
  VIEWS[view].render();
}
function rerender() { VIEWS[currentView].render(); }

function addTopbarAction(btn) { $('#topbarActions').appendChild(btn); }

/* =========================================================
   F1. 캘린더
   ========================================================= */
let calIndex = 0; // MONTHS 인덱스

function renderCalendar() {
  // 오늘이 속한 달로 초기 이동 (최초 진입 시)
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
        <span><span class="cal-dot" style="background:#9a8f95"></span>작업기록</span>
      </div>
    </div>`);
  wrap.appendChild(toolbar);

  const cal = el('<div class="calendar"></div>');
  const weekdays = el('<div class="cal-weekdays"></div>');
  ['일', '월', '화', '수', '목', '금', '토'].forEach(d => weekdays.appendChild(el(`<div>${d}</div>`)));
  cal.appendChild(weekdays);
  const grid = el('<div class="cal-grid" id="calGrid"></div>');
  cal.appendChild(grid);
  wrap.appendChild(cal);
  view.appendChild(wrap);

  $('#calPrev').addEventListener('click', () => { if (calIndex > 0) { calIndex--; drawMonth(); } });
  $('#calNext').addEventListener('click', () => { if (calIndex < MONTHS.length - 1) { calIndex++; drawMonth(); } });

  drawMonth();
}

function todayInRange() {
  const t = todayStr();
  const first = `${MONTHS[0].y}-${pad(MONTHS[0].m + 1)}-01`;
  const lastM = MONTHS[MONTHS.length - 1];
  const lastDay = new Date(lastM.y, lastM.m + 1, 0).getDate();
  const last = `${lastM.y}-${pad(lastM.m + 1)}-${pad(lastDay)}`;
  return (t >= first && t <= last) ? t : first;
}

function calendarDots(dateStr) {
  const dots = [];
  DB.events.filter(e => e.date === dateStr).forEach(e => dots.push(SECTORS[e.sector] || '#9a8f95'));
  DB.cinemas.filter(c => c.status === '상영일정' && c.date === dateStr).forEach(() => dots.push(CINEMA_STATUS['상영일정']));
  if (DB.timestamps.some(t => t.date === dateStr)) dots.push('#9a8f95');
  return dots;
}

function drawMonth() {
  const { y, m } = MONTHS[calIndex];
  $('#calMonth').textContent = `${y}년 ${m + 1}월`;
  $('#calPrev').style.opacity = calIndex === 0 ? .35 : 1;
  $('#calNext').style.opacity = calIndex === MONTHS.length - 1 ? .35 : 1;

  const grid = $('#calGrid');
  grid.innerHTML = '';
  const first = new Date(y, m, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = todayStr();

  const cells = [];
  // 앞쪽 이전달
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

      const dayEvents = DB.events.filter(e => e.date === dateStr).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      const cinemaScreenings = DB.cinemas.filter(cn => cn.status === '상영일정' && cn.date === dateStr);

      const evWrap = el('<div class="cal-events"></div>');
      const combined = [
        ...dayEvents.map(e => ({ label: (e.time ? e.time + ' ' : '') + e.name, color: SECTORS[e.sector], ev: e })),
        ...cinemaScreenings.map(cn => ({ label: '🎬 ' + cn.name, color: CINEMA_STATUS['상영일정'], cinema: cn })),
      ];
      combined.slice(0, 3).forEach(item => {
        const chip = el(`<button class="cal-ev" style="background:${item.color};color:${textColorOn(item.color)}">${esc(item.label)}</button>`);
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.ev) openEventDetail(item.ev);
          else { navigate('cinemas'); }
        });
        evWrap.appendChild(chip);
      });
      if (combined.length > 3) evWrap.appendChild(el(`<div class="cal-more">+${combined.length - 3}개 더</div>`));
      cell.appendChild(evWrap);

      const dots = calendarDots(dateStr);
      if (dots.length) {
        const dotWrap = el('<div class="cal-dots"></div>');
        [...new Set(dots)].slice(0, 5).forEach(col => dotWrap.appendChild(el(`<span class="cal-dot" style="background:${col}"></span>`)));
        cell.appendChild(dotWrap);
      }

      cell.addEventListener('click', () => openEventModal(null, dateStr));
    }
    grid.appendChild(cell);
  });
}

function openEventModal(existing, defaultDate) {
  const e = existing || { name: '', sector: '미팅', date: defaultDate || todayInRange(), time: '', memo: '' };
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
        <div class="field"><label>날짜 <span class="req">*</span></label><input type="date" name="date" value="${e.date}" required /></div>
        <div class="field"><label>시간</label><input type="time" name="time" value="${e.time || ''}" /></div>
      </div>
      <div class="field">
        <label>메모</label>
        <textarea name="memo" placeholder="장소, 준비물 등">${esc(e.memo)}</textarea>
      </div>
    </form>`);
  let sector = e.sector;
  const pick = $('#sectorPick', form);
  Object.entries(SECTORS).forEach(([name, color]) => {
    const p = el(`<button type="button" class="pill ${name === sector ? 'selected' : ''}">${name}</button>`);
    if (name === sector) p.style.background = color;
    p.addEventListener('click', () => {
      sector = name;
      pick.querySelectorAll('.pill').forEach(x => { x.classList.remove('selected'); x.style.background = ''; });
      p.classList.add('selected'); p.style.background = color; p.style.color = textColorOn(color);
    });
    if (name === sector) p.style.color = textColorOn(color);
    pick.appendChild(p);
  });

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
    const data = { name, sector, date: fd.get('date'), time: fd.get('time'), memo: fd.get('memo').trim() };
    if (existing) Object.assign(existing, data);
    else DB.events.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '이벤트가 추가되었습니다');
  }));

  openModal({ title: existing ? '이벤트 편집' : '이벤트 추가', body: form, footer });
}

function openEventDetail(e) {
  const color = SECTORS[e.sector];
  const body = el(`
    <div>
      <div style="margin-bottom:12px"><span class="tag" style="background:${color};color:${textColorOn(color)}">${esc(e.sector)}</span></div>
      <div class="detail-row"><span class="dk">이벤트</span><span class="dv"><strong>${esc(e.name)}</strong></span></div>
      <div class="detail-row"><span class="dk">날짜</span><span class="dv">${fmtDate(e.date)}${e.time ? ' · ' + e.time : ' · 종일'}</span></div>
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

  // 필터
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
  const color = CINEMA_STATUS[c.status];
  const item = el(`<div class="cinema-item">
    <div class="cinema-main">
      <div class="cinema-name">${esc(c.name)}</div>
      <div class="cinema-meta">
        <span>📍 ${esc(c.location)}</span>
        ${c.manager ? `<span>👤 ${esc(c.manager)}</span>` : ''}
        ${c.contact ? `<span>📞 ${esc(c.contact)}</span>` : ''}
        ${c.status === '상영일정' && c.date ? `<span>🎬 ${fmtDate(c.date)}</span>` : ''}
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
  const c = existing || { name: '', location: '', region: '서울', status: '확인중', date: '', manager: '', contact: '', memo: '' };
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
      <div class="field" id="dateField">
        <label>날짜 선택 <span style="color:var(--muted);font-weight:400">(상영일정 상태 시 캘린더 자동 등록)</span></label>
        <input type="date" name="date" value="${c.date || ''}" min="2026-07-01" max="2026-10-31" />
      </div>
      <div class="field-row">
        <div class="field"><label>담당자</label><input type="text" name="manager" placeholder="예) 상아" value="${esc(c.manager)}" /></div>
        <div class="field"><label>연락처</label><input type="text" name="contact" placeholder="전화번호" value="${esc(c.contact)}" /></div>
      </div>
      <div class="field"><label>메모</label><textarea name="memo" placeholder="통화 내용, 특이사항">${esc(c.memo)}</textarea></div>
    </form>`);

  let status = c.status;
  const pick = $('#statusPick', form);
  Object.entries(CINEMA_STATUS).forEach(([name, color]) => {
    const p = el(`<button type="button" class="pill ${name === status ? 'selected' : ''}">${name}</button>`);
    if (name === status) { p.style.background = color; p.style.color = textColorOn(color); }
    p.addEventListener('click', () => {
      status = name;
      pick.querySelectorAll('.pill').forEach(x => { x.classList.remove('selected'); x.style.background = ''; x.style.color = ''; });
      p.classList.add('selected'); p.style.background = color; p.style.color = textColorOn(color);
    });
    pick.appendChild(p);
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
    const data = {
      name, location, region: fd.get('region'), status,
      date: fd.get('date'), manager: fd.get('manager').trim(), contact: fd.get('contact').trim(), memo: fd.get('memo').trim(),
    };
    if (existing) Object.assign(existing, data);
    else DB.cinemas.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender();
    toast(existing ? '수정되었습니다' : '영화관이 등록되었습니다');
  }));

  openModal({ title: existing ? '영화관 편집' : '영화관 등록', body: form, footer });
}

/* =========================================================
   F3. 상영회 아이디어
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
  // 좋아요 많은 순 → 최신 순
  [...list].sort((a, b) => (b.likes || 0) - (a.likes || 0)).forEach(i => grid.appendChild(ideaCard(i)));
  view.appendChild(grid);
}

function ideaCard(i) {
  const color = IDEA_TYPES[i.type];
  const card = el(`<div class="idea-card" style="border-top-color:${color}">
    ${i.image ? `<img src="${esc(i.image)}" alt="" onerror="this.style.display='none'" />` : ''}
    <div class="idea-body">
      <div style="margin-bottom:8px"><span class="tag" style="background:${color};color:${textColorOn(color)}">${esc(i.type)}</span></div>
      <div class="idea-title">${esc(i.title)}</div>
      ${i.content ? `<div class="idea-content">${esc(i.content)}</div>` : ''}
      <div class="idea-foot">
        <button class="like-btn ${i.liked ? 'liked' : ''}" data-act="like">❤ <span>${i.likes || 0}</span></button>
        <button class="btn btn-sm btn-icon" data-act="edit">편집</button>
        <button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button>
        <span class="idea-author">✍ ${esc(i.author)}</span>
      </div>
    </div>
  </div>`);
  $('[data-act=like]', card).addEventListener('click', () => {
    i.liked = !i.liked;
    i.likes = (i.likes || 0) + (i.liked ? 1 : -1);
    if (i.likes < 0) i.likes = 0;
    saveDB(); rerender();
  });
  $('[data-act=edit]', card).addEventListener('click', () => openIdeaModal(i));
  $('[data-act=del]', card).addEventListener('click', () => confirmDelete(`'${i.title}' 아이디어를 삭제할까요?`, () => {
    DB.ideas = DB.ideas.filter(x => x.id !== i.id); saveDB(); rerender(); toast('삭제되었습니다');
  }));
  return card;
}

function openIdeaModal(existing) {
  const i = existing || { title: '', content: '', type: '오프라인 상영회', image: '', author: MEMBERS[0].name, likes: 0 };
  const form = el(`
    <form id="ideaForm">
      <div class="field"><label>제목 <span class="req">*</span></label>
        <input type="text" name="title" value="${esc(i.title)}" required /></div>
      <div class="field"><label>내용</label>
        <textarea name="content" placeholder="아이디어 설명">${esc(i.content)}</textarea></div>
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

  // 유형 선택
  let type = i.type;
  const tp = $('#typePick', form);
  Object.entries(IDEA_TYPES).forEach(([name, color]) => {
    const p = el(`<button type="button" class="pill ${name === type ? 'selected' : ''}">${name}</button>`);
    if (name === type) { p.style.background = color; p.style.color = textColorOn(color); }
    p.addEventListener('click', () => {
      type = name;
      tp.querySelectorAll('.pill').forEach(x => { x.classList.remove('selected'); x.style.background = ''; x.style.color = ''; });
      p.classList.add('selected'); p.style.background = color; p.style.color = textColorOn(color);
    });
    tp.appendChild(p);
  });

  // 작성자 선택
  let author = i.author;
  const ap = $('#authorPick', form);
  MEMBERS.forEach(m => {
    const p = el(`<button type="button" class="pill ${m.name === author ? 'selected' : ''}">${m.name}</button>`);
    if (m.name === author) { p.style.background = m.color; p.style.color = textColorOn(m.color); }
    p.addEventListener('click', () => {
      author = m.name;
      ap.querySelectorAll('.pill').forEach(x => { x.classList.remove('selected'); x.style.background = ''; x.style.color = ''; });
      p.classList.add('selected'); p.style.background = m.color; p.style.color = textColorOn(m.color);
    });
    ap.appendChild(p);
  });

  // 이미지 입력 모드
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
    const data = { title, content: form.querySelector('[name=content]').value.trim(), type, image: imageData, author };
    if (existing) Object.assign(existing, data);
    else DB.ideas.push({ id: uid(), likes: 0, liked: false, ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '아이디어가 추가되었습니다');
  }));

  openModal({ title: existing ? '아이디어 편집' : '아이디어 추가', body: form, footer });
}

/* =========================================================
   F4. 회계 시트
   ========================================================= */
let accCharts = { donut: null, bar: null };

function accStats() {
  const income = DB.accounting.filter(a => a.type === '입금').reduce((s, a) => s + Number(a.amount || 0), 0);
  const expense = DB.accounting.filter(a => a.type === '출금').reduce((s, a) => s + Number(a.amount || 0), 0);
  const budget = Number(DB.budget || 0);
  const balance = budget - expense + income;
  return { income, expense, budget, balance };
}

function renderAccounting() {
  addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportAccounting()));
  addTopbarAction(mkBtn('버짓 설정', 'btn-sm', () => openBudgetModal()));
  addTopbarAction(mkBtn('+ 내역', 'btn-sm btn-primary', () => openAccModal(null)));

  const view = $('#view');
  const { income, expense, budget, balance } = accStats();
  const rate = budget > 0 ? Math.min(100, Math.round(expense / budget * 100)) : 0;

  // 요약 카드
  const summary = el(`<div class="summary-cards">
    <div class="card sum-card">
      <div class="sum-label">총 버짓</div>
      <div class="sum-value">${won(budget)}</div>
      <div class="progress"><div class="progress-fill" style="width:${rate}%"></div></div>
      <div class="sum-sub">사용률 ${rate}% · 잔액 ${won(balance)}</div>
    </div>
    <div class="card sum-card">
      <div class="sum-label">사용금액 (출금)</div>
      <div class="sum-value neg">${won(expense)}</div>
      <div class="sum-sub">전체 지출 합계</div>
    </div>
    <div class="card sum-card">
      <div class="sum-label">수익금액 (입금)</div>
      <div class="sum-value pos">${won(income)}</div>
      <div class="sum-sub">전체 입금 합계</div>
    </div>
  </div>`);
  view.appendChild(summary);

  // 차트
  const charts = el(`<div class="charts">
    <div class="card chart-card"><h4>구분별 지출 비중</h4><div class="chart-wrap"><canvas id="donutChart"></canvas></div></div>
    <div class="card chart-card"><h4>월별 입출금 추이</h4><div class="chart-wrap"><canvas id="barChart"></canvas></div></div>
  </div>`);
  view.appendChild(charts);

  // 리스트
  if (!DB.accounting.length) {
    view.appendChild(el(`<div class="empty"><span class="empty-emoji">💰</span>아직 입출금 내역이 없어요.<br>우측 상단 <b>+ 내역</b>으로 추가해보세요.</div>`));
  } else {
    const scroll = el('<div class="table-scroll"></div>');
    const table = el(`<table class="data">
      <thead><tr><th>날짜</th><th>유형</th><th>구분</th><th>항목</th><th>내용</th><th style="text-align:right">금액</th><th></th></tr></thead>
      <tbody></tbody></table>`);
    const tb = $('tbody', table);
    [...DB.accounting].sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(a => {
      const col = ACC_CATEGORIES[a.category];
      const tr = el(`<tr>
        <td>${fmtDate(a.date)}</td>
        <td><span class="tag ${a.type === '입금' ? '' : ''}" style="background:${a.type === '입금' ? 'var(--p4)' : 'var(--p3)'};color:#fff">${a.type}</span></td>
        <td><span class="tag" style="background:${col};color:${textColorOn(col)}">${a.category}</span></td>
        <td><strong>${esc(a.item)}</strong></td>
        <td style="color:var(--muted)">${esc(a.content || '')}</td>
        <td class="amt ${a.type === '입금' ? 'in' : 'out'}">${a.type === '입금' ? '+' : '-'}${comma(a.amount)}</td>
        <td><div class="row-actions"><button class="btn btn-sm btn-icon" data-act="edit">편집</button><button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button></div></td>
      </tr>`);
      $('[data-act=edit]', tr).addEventListener('click', () => openAccModal(a));
      $('[data-act=del]', tr).addEventListener('click', () => confirmDelete(`'${a.item}' 내역을 삭제할까요?`, () => {
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
  if (accCharts.donut) accCharts.donut.destroy();
  if (accCharts.bar) accCharts.bar.destroy();
  if (typeof Chart === 'undefined') return;

  // 도넛: 구분별 지출
  const byCat = {};
  DB.accounting.filter(a => a.type === '출금').forEach(a => { byCat[a.category] = (byCat[a.category] || 0) + Number(a.amount || 0); });
  const cats = Object.keys(ACC_CATEGORIES).filter(c => byCat[c]);
  const donutCtx = $('#donutChart');
  if (donutCtx) {
    if (cats.length) {
      accCharts.donut = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: cats,
          datasets: [{ data: cats.map(c => byCat[c]), backgroundColor: cats.map(c => ACC_CATEGORIES[c]), borderWidth: 2, borderColor: '#fff' }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { font: { family: "'Noto Sans KR'" }, padding: 12, boxWidth: 12 } },
            tooltip: { callbacks: { label: (c) => `${c.label}: ${won(c.raw)}` } } },
        },
      });
    } else emptyCanvas(donutCtx, '지출 내역 없음');
  }

  // 막대: 월별 입출금
  const barCtx = $('#barChart');
  if (barCtx) {
    const labels = MONTHS.map(m => `${m.m + 1}월`);
    const inData = MONTHS.map(() => 0), outData = MONTHS.map(() => 0);
    DB.accounting.forEach(a => {
      if (!a.date) return;
      const mm = Number(a.date.split('-')[1]) - 1;
      const idx = MONTHS.findIndex(m => m.m === mm);
      if (idx < 0) return;
      if (a.type === '입금') inData[idx] += Number(a.amount || 0);
      else outData[idx] += Number(a.amount || 0);
    });
    if (DB.accounting.length) {
      accCharts.bar = new Chart(barCtx, {
        type: 'bar',
        data: { labels, datasets: [
          { label: '입금', data: inData, backgroundColor: '#31cc66', borderRadius: 5 },
          { label: '출금', data: outData, backgroundColor: '#ff7300', borderRadius: 5 },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { family: "'Noto Sans KR'" }, padding: 12, boxWidth: 12 } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${won(c.raw)}` } } },
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
  const a = existing || { type: '출금', category: '대관비', item: '', content: '', amount: '', date: todayStr() };
  const form = el(`
    <form id="accForm">
      <div class="field"><label>유형 <span class="req">*</span></label>
        <div class="seg" id="typeSeg">
          <button type="button" data-v="입금" class="${a.type === '입금' ? 'active' : ''}">입금</button>
          <button type="button" data-v="출금" class="${a.type === '출금' ? 'active' : ''}">출금</button>
        </div></div>
      <div class="field"><label>구분 <span class="req">*</span></label>
        <select name="category">${Object.keys(ACC_CATEGORIES).map(c => `<option ${c === a.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label>항목 <span class="req">*</span></label>
        <input type="text" name="item" placeholder="예) 대관료 선금" value="${esc(a.item)}" required /></div>
      <div class="field"><label>내용</label>
        <input type="text" name="content" placeholder="상세 설명" value="${esc(a.content)}" /></div>
      <div class="field-row">
        <div class="field"><label>금액 (원) <span class="req">*</span></label>
          <input type="text" name="amount" inputmode="numeric" value="${a.amount ? comma(a.amount) : ''}" required /></div>
        <div class="field"><label>날짜 <span class="req">*</span></label>
          <input type="date" name="date" value="${a.date}" required /></div>
      </div>
    </form>`);

  let type = a.type;
  $('#typeSeg', form).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    type = b.dataset.v;
    $('#typeSeg', form).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  }));
  const amt = form.querySelector('[name=amount]');
  amt.addEventListener('input', () => { const n = amt.value.replace(/[^\d]/g, ''); amt.value = n ? comma(n) : ''; });

  const footer = [];
  if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => confirmDelete(`'${a.item}' 내역을 삭제할까요?`, () => {
    DB.accounting = DB.accounting.filter(x => x.id !== a.id); saveDB(); closeModal(); rerender(); toast('삭제되었습니다');
  })));
  footer.push(mkBtn('취소', 'btn-ghost', closeModal));
  footer.push(mkBtn(existing ? '저장' : '추가', 'btn-primary', () => {
    const fd = new FormData(form);
    const item = fd.get('item').trim();
    const amount = Number(fd.get('amount').replace(/[^\d]/g, '') || 0);
    if (!item) return toast('항목을 입력해주세요');
    if (!amount) return toast('금액을 입력해주세요');
    const data = { type, category: fd.get('category'), item, content: fd.get('content').trim(), amount, date: fd.get('date') };
    if (existing) Object.assign(existing, data);
    else DB.accounting.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '내역이 추가되었습니다');
  }));

  openModal({ title: existing ? '내역 편집' : '입출금 등록', body: form, footer });
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
    const card = el(`<div class="card ts-member">
      <div class="ts-member-top"><span class="tag-dot" style="background:${m.color}"></span><span class="ts-member-name">${m.name}</span></div>
      <div class="ts-member-hours">${h}<span style="font-size:13px;color:var(--muted);font-weight:400"> 시간</span></div>
      <div class="ts-bar"><div class="ts-bar-fill" style="width:${Math.round(h / maxHours * 100)}%;background:${m.color}"></div></div>
    </div>`);
    members.appendChild(card);
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

function openTsModal(existing) {
  const t = existing || { name: MEMBERS[0].name, date: todayStr(), hours: '', work: '' };
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

  let name = t.name;
  const np = $('#tsNamePick', form);
  MEMBERS.forEach(m => {
    const p = el(`<button type="button" class="pill ${m.name === name ? 'selected' : ''}">${m.name}</button>`);
    if (m.name === name) { p.style.background = m.color; p.style.color = textColorOn(m.color); }
    p.addEventListener('click', () => {
      name = m.name;
      np.querySelectorAll('.pill').forEach(x => { x.classList.remove('selected'); x.style.background = ''; x.style.color = ''; });
      p.classList.add('selected'); p.style.background = m.color; p.style.color = textColorOn(m.color);
    });
    np.appendChild(p);
  });

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
    const data = { name, date: fd.get('date'), hours, work };
    if (existing) Object.assign(existing, data);
    else DB.timestamps.push({ id: uid(), ...data });
    saveDB(); closeModal(); rerender(); toast(existing ? '수정되었습니다' : '기록이 추가되었습니다');
  }));

  openModal({ title: existing ? '기록 편집' : '작업 기록 추가', body: form, footer });
}

/* =========================================================
   엑셀 백업 (SheetJS)
   ========================================================= */
function fileName(menu) { return `빅활동_${menu}_${stampToday()}.xlsx`; }

function sheetFrom(rows) { return XLSX.utils.json_to_sheet(rows); }

function eventsRows() {
  return [...DB.events].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => ({
    날짜: e.date, 시간: e.time || '종일', 이벤트명: e.name, 섹터: e.sector, 메모: e.memo || '',
  }));
}
function cinemasRows() {
  return DB.cinemas.map(c => ({
    지역: c.region, 영화관: c.name, 위치: c.location, 상태: c.status,
    상영일정: c.date || '', 담당자: c.manager || '', 연락처: c.contact || '', 메모: c.memo || '',
  }));
}
function ideasRows() {
  return DB.ideas.map(i => ({
    제목: i.title, 유형: i.type, 내용: i.content || '', 작성자: i.author, 좋아요: i.likes || 0,
    이미지: i.image && i.image.startsWith('data:') ? '(업로드 이미지)' : (i.image || ''),
  }));
}
function accountingRows() {
  return [...DB.accounting].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(a => ({
    날짜: a.date, 유형: a.type, 구분: a.category, 항목: a.item, 내용: a.content || '', 금액: Number(a.amount || 0),
  }));
}
function timestampsRows() {
  return [...DB.timestamps].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(t => ({
    날짜: t.date, 이름: t.name, 시간: t.hours, 한일: t.work,
  }));
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
function exportIdeas() { downloadSheet(ideasRows(), '상영회아이디어', '아이디어'); }
function exportAccounting() {
  const rows = accountingRows();
  if (!rows.length) return toast('내보낼 데이터가 없어요');
  const { income, expense, budget, balance } = accStats();
  rows.push({}, { 날짜: '요약', 유형: '', 구분: '총 버짓', 항목: budget });
  rows.push({ 날짜: '', 유형: '', 구분: '사용금액', 항목: expense });
  rows.push({ 날짜: '', 유형: '', 구분: '수익금액', 항목: income });
  rows.push({ 날짜: '', 유형: '', 구분: '잔액', 항목: balance });
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
  XLSX.writeFile(wb, `빅활동_전체백업_${stampToday()}.xlsx`);
  toast('전체 데이터를 백업했어요');
}

/* =========================================================
   초기화 / 이벤트 바인딩
   ========================================================= */
function init() {
  document.querySelectorAll('.nav-item, .bn-item').forEach(b => b.addEventListener('click', () => navigate(b.dataset.view)));
  $('#backupAllBtn').addEventListener('click', exportAll);
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalRoot').hidden) closeModal(); });

  // 오늘 날짜가 범위 안이면 해당 달로 시작
  const t = todayStr();
  const idx = MONTHS.findIndex(m => t.startsWith(`${m.y}-${pad(m.m + 1)}`));
  if (idx >= 0) calIndex = idx;

  navigate('calendar');
}

document.addEventListener('DOMContentLoaded', init);
