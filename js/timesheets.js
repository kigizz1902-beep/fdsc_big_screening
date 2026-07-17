/* =========================================================
   타임시트 (Supabase 관계형 테이블 버전)
   ---------------------------------------------------------
   · 원본 데이터 = Supabase 의 timesheets / members 테이블 (localStorage·bigact 아님)
   · app.js 의 기존 헬퍼(el, $, openModal, mkBtn, pillSelect, confirmDelete,
     toast, addTopbarAction, rerender, fmtDate, esc, textColorOn, todayStr,
     downloadSheet, currentView, VIEWS)를 그대로 재사용한다.
   · supabase.js 의 supabaseClient(연결 객체)를 재사용한다.
   · 로드 순서: supabase-js → supabase.js → app.js → (이 파일)
   · app.js 의 renderTimestamps/openTsModal 은 삭제하지 않고 남겨둔다(캘린더 폴백).
     이 파일이 VIEWS.timestamps.render 만 오버라이드해 타임시트 "메뉴"를 대체한다.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 모듈 상태 (화면 원본은 Supabase, 여기는 조회 캐시일 뿐) ---------- */
  let members = [];      // 활성 팀원 [{id,name,color,role,display_order,is_active}]
  let records = [];      // 작업 기록 (members 조인 포함)
  let loaded = false;    // 최초 로드 완료 여부
  let loading = false;   // 조회 진행 중
  let errorMsg = null;   // 사용자 표시용 오류 메시지

  const PAGE_SIZE = 10;  // 화면에 한 번에 보여줄 기록 수
  let page = 1;          // 현재 페이지 (1 = 최신)

  /* ---------- 유틸 ---------- */
  function friendly(e) {
    const msg = (e && (e.message || e.error_description || e.details)) || '';
    // 테이블 미생성(42P01) 등 흔한 케이스 안내
    if (/relation .* does not exist|42P01/i.test(msg)) {
      return 'timesheets/members 테이블이 없습니다. sql/timesheets.sql 을 먼저 실행하세요.';
    }
    return msg || '알 수 없는 오류';
  }
  function fmtHours(n) { return String(+Number(n || 0).toFixed(2)); } // 2.00→"2", 2.50→"2.5"

  /* ---------- Supabase 조회 ---------- */
  // 활성 팀원만 display_order 순으로 (하드코딩 MEMBERS 로 대체하지 않음)
  async function fetchMembers() {
    const { data, error } = await supabaseClient
      .from('members')
      .select('id, name, color, role, display_order, is_active')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function fetchTimesheets() {
    // Supabase JS 관계 조회: timesheets.member_id → members.id (FK) 임베드
    const { data, error } = await supabaseClient
      .from('timesheets')
      .select('id, member_id, work_date, hours, description, created_at, updated_at, members ( id, name, color, display_order )')
      .order('work_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    // 화면·캘린더·엑셀이 쓰기 쉬운 형태로 변환 (원본은 항상 Supabase)
    return (data || []).map(r => {
      const mem = r.members || {};
      return {
        id: r.id,
        memberId: r.member_id,
        name: mem.name || '(알 수 없음)',
        color: mem.color || '#9a8f95',
        displayOrder: mem.display_order,
        date: r.work_date,
        hours: Number(r.hours || 0),
        work: r.description,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  async function reload() {
    if (!supabaseClient) return;
    loading = true;
    try {
      const [ms, ts] = await Promise.all([fetchMembers(), fetchTimesheets()]);
      members = ms;
      records = ts;
      loaded = true;
      errorMsg = null;
    } catch (e) {
      console.error('[timesheets] 데이터 조회 실패', e);
      // 팀원 로드 실패를 하드코딩 팀원으로 숨기지 않고 DB 오류를 그대로 노출
      errorMsg = friendly(e);
    } finally {
      loading = false;
      publishGlobals(); // 캘린더·엑셀(app.js)이 볼 수 있게 최신 데이터 게시
      // 조회가 끝났을 때 타임시트 또는 캘린더 화면이면만 다시 그림 (그 외 화면은 안 건드림)
      if (typeof currentView !== 'undefined' && (currentView === 'timestamps' || currentView === 'calendar')) rerender();
    }
  }

  // app.js(캘린더·백업)가 참조할 수 있도록 전역에 최신 타임시트 데이터를 게시
  function publishGlobals() {
    window.timesheetRecords = records;
    window.timesheetMembers = members;
  }

  /* ---------- 화면 그리기 ---------- */
  function render() {
    addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', onExport));
    addTopbarAction(mkBtn('+ 기록', 'btn-sm btn-primary', () => openForm(null)));

    const view = $('#view');

    if (!supabaseClient) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">☁️</span>
        클라우드가 설정되지 않았습니다.<br>supabase.js 의 URL/KEY 를 확인하세요.</div>`));
      return;
    }
    if (errorMsg) {
      const box = el(`<div class="empty"><span class="empty-emoji">⚠️</span>
        타임시트를 불러오지 못했어요.<br><span class="hint">${esc(errorMsg)}</span><br><br></div>`);
      box.appendChild(mkBtn('다시 시도', 'btn-sm btn-primary', () => { errorMsg = null; reload(); rerender(); }));
      view.appendChild(box);
      return;
    }
    if (!loaded) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏳</span>타임시트를 불러오는 중…</div>`));
      if (!loading) reload();
      return;
    }

    /* --- 합계 요약 (DB에 저장하지 않고 조회 데이터로 계산) --- */
    const totals = {};
    members.forEach(m => { totals[m.id] = 0; });
    records.forEach(r => { totals[r.memberId] = (totals[r.memberId] || 0) + Number(r.hours || 0); });
    const grandTotal = records.reduce((s, r) => s + Number(r.hours || 0), 0);
    const maxHours = Math.max(1, ...Object.values(totals));

    const summary = el('<div class="ts-summary"></div>');
    summary.appendChild(el(`<div class="card ts-total"><span class="sum-label">팀 전체 총 작업시간</span><span class="sum-value">${fmtHours(grandTotal)}</span><span class="sum-label">시간</span></div>`));
    const memWrap = el('<div class="ts-members"></div>');
    members.forEach(m => {
      const h = totals[m.id] || 0;
      memWrap.appendChild(el(`<div class="card ts-member">
        <div class="ts-member-top"><span class="tag-dot" style="background:${m.color || '#9a8f95'}"></span><span class="ts-member-name">${esc(m.name)}</span></div>
        <div class="ts-member-hours">${fmtHours(h)}<span style="font-size:13px;color:var(--muted);font-weight:400"> 시간</span></div>
        <div class="ts-bar"><div class="ts-bar-fill" style="width:${Math.round(h / maxHours * 100)}%;background:${m.color || '#9a8f95'}"></div></div>
      </div>`));
    });
    summary.appendChild(memWrap);
    view.appendChild(summary);

    if (!records.length) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏱️</span>아직 작업 기록이 없어요.<br>우측 상단 <b>+ 기록</b>으로 추가해보세요.</div>`));
      return;
    }

    /* --- 기록 표 (페이지당 10개, 최신순) --- */
    const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    const startIdx = (page - 1) * PAGE_SIZE;
    const pageRecords = records.slice(startIdx, startIdx + PAGE_SIZE);

    const scroll = el('<div class="table-scroll"></div>');
    const table = el(`<table class="data">
      <thead><tr><th>날짜</th><th>이름</th><th style="text-align:right">시간</th><th>한 일</th><th></th></tr></thead>
      <tbody></tbody></table>`);
    const tb = $('tbody', table);
    pageRecords.forEach(r => {
      const col = r.color || '#9a8f95';
      const tr = el(`<tr>
        <td>${fmtDate(r.date)}</td>
        <td><span class="tag" style="background:${col};color:${textColorOn(col)}">${esc(r.name)}</span></td>
        <td class="amt">${fmtHours(r.hours)}h</td>
        <td>${esc(r.work)}</td>
        <td><div class="row-actions"><button class="btn btn-sm btn-icon" data-act="edit">편집</button><button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button></div></td>
      </tr>`);
      $('[data-act=edit]', tr).addEventListener('click', () => openForm(r));
      $('[data-act=del]', tr).addEventListener('click', () => onDelete(r));
      tb.appendChild(tr);
    });
    scroll.appendChild(table);
    view.appendChild(scroll);

    view.appendChild(renderPager(totalPages, records.length, startIdx, pageRecords.length));
  }

  /* ---------- 페이지네이션 ---------- */
  function renderPager(totalPages, totalCount, startIdx, shown) {
    const wrap = el('<div class="ts-pager" style="margin-top:14px"></div>');
    wrap.appendChild(el(`<div class="hint" style="text-align:center;margin-bottom:8px">전체 ${totalCount}건 · ${startIdx + 1}–${startIdx + shown} 표시 · 페이지 ${page} / ${totalPages}</div>`));
    if (totalPages <= 1) return wrap; // 한 페이지뿐이면 정보만 표시

    const bar = el('<div style="display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap"></div>');
    const nav = (label, target, opts) => {
      opts = opts || {};
      const b = el(`<button class="btn btn-sm ${opts.active ? 'btn-primary' : ''}" ${opts.disabled ? 'disabled' : ''}>${label}</button>`);
      if (!opts.disabled && !opts.active) b.addEventListener('click', () => { page = target; rerender(); });
      return b;
    };
    bar.appendChild(nav('‹', page - 1, { disabled: page <= 1 }));
    pageWindow(page, totalPages, 5).forEach(p => bar.appendChild(nav(String(p), p, { active: p === page })));
    bar.appendChild(nav('›', page + 1, { disabled: page >= totalPages }));
    wrap.appendChild(bar);
    return wrap;
  }
  // 현재 페이지 주변의 페이지 번호 창(최대 size개)을 반환
  function pageWindow(cur, total, size) {
    let s = Math.max(1, cur - Math.floor(size / 2));
    let e = Math.min(total, s + size - 1);
    s = Math.max(1, e - size + 1);
    const arr = [];
    for (let p = s; p <= e; p++) arr.push(p);
    return arr;
  }

  /* ---------- 추가 / 수정 모달 ---------- */
  function openForm(existing, defaultDate) {
    if (!members.length) { toast('등록된 팀원이 없습니다. sql/timesheets.sql 을 확인하세요.'); return; }
    const multi = !existing; // 추가일 때만 여러 명 선택 (편집은 한 행 = 한 명)
    const initName = existing ? (existing.name || members[0].name) : members[0].name;
    const date = existing ? existing.date : (defaultDate || (typeof todayStr === 'function' ? todayStr() : ''));
    const hours = existing ? existing.hours : '';
    const desc = existing ? existing.work : '';

    const nameLabel = multi
      ? `<span>이름 <span class="req">*</span> <span class="hint" style="font-weight:400">(여러 명 선택 가능)</span></span>
         <button type="button" class="btn btn-sm btn-ghost" id="tsAllBtn">전체</button>`
      : `<span>이름 <span class="req">*</span></span>`;

    const form = el(`
      <form id="tsForm">
        <div class="field"><label style="display:flex;justify-content:space-between;align-items:center;gap:8px">${nameLabel}</label>
          <div class="pill-select" id="tsNamePick"></div></div>
        <div class="field-row">
          <div class="field"><label>날짜 <span class="req">*</span></label>
            <input type="date" name="date" value="${esc(date)}" required /></div>
          <div class="field"><label>시간 <span class="req">*</span></label>
            <input type="number" name="hours" step="0.5" min="0" max="24" placeholder="예) 2.5" value="${esc(String(hours))}" required /></div>
        </div>
        <div class="field"><label>한 일 <span class="req">*</span></label>
          <input type="text" name="work" placeholder="예) 영화관 3곳 컨택" value="${esc(desc)}" required /></div>
      </form>`);

    const entries = members.map(m => [m.name, m.color || '#9a8f95']);
    const pick = $('#tsNamePick', form);
    let getNames; // 항상 이름 배열을 반환
    if (multi) {
      const getArr = pillMultiSelect(pick, entries, []);
      getNames = getArr;
      // '전체' 버튼: 모두 선택 ↔ 모두 해제 토글 (pillMultiSelect의 클릭 핸들러 재사용)
      $('#tsAllBtn', form).addEventListener('click', () => {
        const pills = [...pick.querySelectorAll('.pill')];
        const allOn = pills.every(p => p.classList.contains('selected'));
        pills.forEach(p => {
          const on = p.classList.contains('selected');
          if (allOn === on) p.click(); // 전부 켜져있으면 끄고, 아니면 꺼진 것만 켬
        });
      });
    } else {
      const getOne = pillSelect(pick, entries, initName);
      getNames = () => [getOne()];
    }

    const footer = [];
    if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => onDelete(existing)));
    footer.push(mkBtn('취소', 'btn-ghost', closeModal));
    const saveBtn = mkBtn(existing ? '저장' : '추가', 'btn-primary', () => submit(saveBtn, form, getNames, existing));
    footer.push(saveBtn);

    openModal({ title: existing ? '기록 편집' : '작업 기록 추가', body: form, footer });
  }

  async function submit(btn, form, getNames, existing) {
    const fd = new FormData(form);
    const names = getNames();
    const hours = Number(fd.get('hours'));
    const work_date = fd.get('date');
    const description = String(fd.get('work') || '').trim();

    const chosen = (names || []).map(n => members.find(m => m.name === n)).filter(Boolean);
    if (!chosen.length) return toast('팀원을 한 명 이상 선택해주세요');
    if (!work_date) return toast('날짜를 입력해주세요');
    if (!hours || hours <= 0 || hours > 24) return toast('시간은 0 초과 24 이하로 입력해주세요');
    if (!description) return toast('한 일을 입력해주세요');

    btn.disabled = true; // 중복 클릭 방지
    try {
      let resp;
      if (existing) {
        // 편집은 단일 행 — 선택된 첫 팀원으로 갱신
        resp = await supabaseClient
          .from('timesheets')
          .update({ member_id: chosen[0].id, work_date, hours, description, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        // 추가 — 선택한 팀원 수만큼 같은 내용의 행을 한 번에 insert
        const rows = chosen.map(m => ({ member_id: m.id, work_date, hours, description }));
        resp = await supabaseClient.from('timesheets').insert(rows);
      }
      if (resp.error) throw resp.error;
      if (!existing) page = 1; // 새 기록은 최신 → 첫 페이지로 이동
      closeModal();
      toast(existing
        ? '수정되었습니다'
        : (chosen.length > 1 ? `${chosen.length}명에게 기록이 추가되었습니다` : '기록이 추가되었습니다'));
      await reload();
    } catch (e) {
      console.error('[timesheets] 저장 실패', e);
      toast('저장에 실패했습니다: ' + friendly(e));
      btn.disabled = false; // 실패 시 원상 복구
    }
  }

  function onDelete(rec) {
    confirmDelete('이 작업 기록을 삭제할까요?', async () => {
      try {
        const { error } = await supabaseClient.from('timesheets').delete().eq('id', rec.id);
        if (error) throw error;
        toast('삭제되었습니다');
        await reload();
      } catch (e) {
        console.error('[timesheets] 삭제 실패', e);
        toast('삭제에 실패했습니다: ' + friendly(e));
      }
    });
  }

  /* ---------- 엑셀 내보내기 (조회 데이터 기준) ---------- */
  function onExport() {
    if (!records.length) return toast('내보낼 데이터가 없어요');
    const rows = records.slice()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      .map(r => ({ 날짜: r.date, 이름: r.name, 시간: Number(r.hours), 한일: r.work }));
    const totals = {};
    records.forEach(r => { totals[r.memberId] = (totals[r.memberId] || 0) + Number(r.hours || 0); });
    rows.push({});
    members.forEach(m => { if (totals[m.id]) rows.push({ 날짜: '합계', 이름: m.name, 시간: totals[m.id], 한일: '' }); });
    if (typeof downloadSheet === 'function') downloadSheet(rows, '타임시트', '타임시트');
    else toast('엑셀 모듈을 찾을 수 없어요');
  }

  /* ---------- app.js(캘린더·초기화)에서 호출할 공개 API ---------- */
  window.loadTimesheetData = reload;                 // 앱 초기화/캘린더에서 데이터 보장용
  window.openTimesheetForm = openForm;               // 캘린더에서 기록 추가·편집
  publishGlobals();                                  // 초기 빈 배열 게시 (캘린더가 먼저 그려져도 안전)

  /* ---------- 라우터에 연결 (기존 renderTimestamps 대체) ---------- */
  if (typeof VIEWS !== 'undefined' && VIEWS && VIEWS.timestamps) {
    VIEWS.timestamps.render = render;
  } else {
    console.warn('[timesheets] VIEWS.timestamps 를 찾지 못했습니다 — 오버라이드 건너뜀');
  }
})();
