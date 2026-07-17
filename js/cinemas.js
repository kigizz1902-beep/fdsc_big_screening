/* =========================================================
   영화관·대관처 디렉터리 (Supabase 관계형, 게시판형 UI)
   ---------------------------------------------------------
   원본: cinemas / cinema_members / cinema_contact_logs /
         cinema_screening_dates / cinema_links (+ members)
   · DB.cinemas / localStorage / bigact 를 원본으로 쓰지 않음. Storage 미사용.
   · app.js 헬퍼(el,$,openModal,closeModal,mkBtn,confirmDelete,toast,addTopbarAction,
     rerender,esc,textColorOn,fmtDate,won,comma,todayStr,currentView,VIEWS,REGIONS,
     XLSX,sheetFrom,stampToday)와 supabase.js 의 supabaseClient 재사용.
   · 데이터가 작아 전체 1회 조회 후 JS 에서 검색·필터·정렬·페이지네이션(안정성·가독성 우선).
   보안: 로그인 없음 — member_id 는 화면에서 고른 담당자 표시일 뿐.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 표시 설정(화면용) ---------- */
  const STATUS = {
    researching: { label: '확인중', color: '#fece00' },
    contacted:   { label: '연락완료', color: '#00a3fe' },
    available:   { label: '대관가능', color: '#31cc66' },
    booked:      { label: '대관확정', color: '#a78bfa' },
    unavailable: { label: '대관불가', color: '#9a8f95' },
  };
  const DATE_TYPE = { candidate: '후보일', available: '가능일', unavailable: '불가일', confirmed: '확정일' };
  const METHOD = { phone: '전화', email: '이메일', form: '문의 폼', visit: '방문', message: '메시지', other: '기타' };
  const LINK_TYPE = { website: '홈페이지', map: '지도', quote: '견적', contact_form: '문의 폼', document: '문서', other: '기타' };
  const statusLabel = (s) => (STATUS[s] ? STATUS[s].label : s || '-');
  const statusColor = (s) => (STATUS[s] ? STATUS[s].color : '#9a8f95');

  /* ---------- 상태 ---------- */
  let cinemas = [], members = [];
  let loaded = false, loading = false, errorMsg = null, reqSeq = 0;
  let currentDetailId = null;
  const filters = { search: '', status: '', region: '', memberId: '', costMin: '', costMax: '', dateFrom: '', dateTo: '', includeArchived: false, sort: 'updated_desc', page: 1, pageSize: 10 };

  /* ---------- CSS 1회 주입(기존 테마 변수 재사용, 반응형 표↔카드) ---------- */
  function injectCss() {
    if (document.getElementById('cinema-board-css')) return;
    const s = document.createElement('style');
    s.id = 'cinema-board-css';
    s.textContent = `
      .cin-summary{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px}
      .cin-sum{flex:1;min-width:120px;cursor:pointer;border:1px solid var(--line,#eadfd9);border-radius:12px;padding:12px 14px;background:var(--card,#fff)}
      .cin-sum.active{outline:2px solid var(--p2,#00a3fe)}
      .cin-sum .n{font-size:22px;font-weight:700}.cin-sum .l{font-size:12.5px;color:var(--muted,#9a8f95)}
      .cin-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
      .cin-toolbar input,.cin-toolbar select{padding:8px 10px;border:1px solid var(--line,#eadfd9);border-radius:9px;font-size:14px}
      .cin-toolbar select{background:#efece9;border-color:#ded7d1}
      .cin-toolbar select:hover{background:#e9e5e1}
      .cin-toolbar [data-action=more-filter]{background:var(--p5,#00a3fe);color:#fff;border-color:var(--p5,#00a3fe)}
      .cin-toolbar [data-action=more-filter]:hover{filter:brightness(1.06)}
      .cin-search{flex:1;min-width:160px}
      .cin-fchips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
      .cin-fchip{background:var(--p2,#00a3fe);color:#fff;border-radius:20px;padding:3px 10px;font-size:12.5px;display:inline-flex;gap:6px;align-items:center}
      .cin-fchip button{background:none;border:none;color:#fff;cursor:pointer;font-size:13px}
      .cin-row{cursor:pointer}
      .cin-cards{display:none}
      .cin-card{cursor:pointer;border:1px solid var(--line,#eadfd9);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--card,#fff)}
      .cin-card .nm{font-weight:700;margin-bottom:4px}
      .cin-card .mt{font-size:12.5px;color:var(--muted,#9a8f95);display:flex;flex-wrap:wrap;gap:8px}
      .cin-pager{display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:14px}
      .cin-linkchip{display:inline-flex;align-items:center;gap:4px;max-width:180px;padding:3px 8px;border-radius:7px;background:var(--bg,#f5f2f0);color:inherit;text-decoration:none;font-size:12px;overflow:hidden}
      .cin-linkchip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cin-sec{margin:14px 0}.cin-sec h4{margin:0 0 6px;font-size:13.5px}
      .cin-log{border-left:3px solid var(--line,#eadfd9);padding:6px 0 6px 10px;margin-bottom:8px}
      .cin-log.overdue{border-left-color:#ff7300}
      /* 등록/편집 폼의 일정·링크 리페터: 모달 폭 안에서 줄바꿈(가로 스크롤 방지) */
      #cinForm .field input,#cinForm .field select,#cinForm .field textarea{width:100%;box-sizing:border-box}
      .cin-repeat{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px}
      .cin-repeat>*{min-width:0;box-sizing:border-box}
      .cin-repeat select,.cin-repeat input{flex:1 1 90px;min-width:0;padding:7px 8px;border:1px solid var(--line,#eadfd9);border-radius:8px;font-size:13px}
      .cin-repeat .rm{flex:0 0 auto}
      .cin-actbtns{display:flex;gap:4px;white-space:nowrap}
      @media (max-width:760px){ .cin-table-wrap{display:none} .cin-cards{display:block} }
    `;
    document.head.appendChild(s);
  }

  /* ---------- 유틸 ---------- */
  function friendly(e) {
    const m = (e && (e.message || e.details || e.error_description)) || '';
    if (/relation .* does not exist|42P01/i.test(m)) return '영화관 테이블이 없습니다. sql/cinemas.sql 을 먼저 실행하세요.';
    return m || '알 수 없는 오류';
  }
  function normalizeLink(raw) {
    const u = String(raw || '').trim();
    if (!u) return { ok: true, value: null };
    const w = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    try { new URL(w); } catch (e) { return { ok: false }; }
    return { ok: /^https?:\/\//i.test(w), value: w };
  }
  function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function costText(n) { return (n === null || n === undefined) ? '-' : won(Number(n)); }
  function nearestDate(c) { // 오늘 이후 가장 가까운 일정(없으면 가장 이른 일정, 그래도 없으면 null)
    const ds = c.dates.map(d => d.date).filter(Boolean).sort();
    if (!ds.length) return null;
    const t = todayStr();
    return ds.find(d => d >= t) || ds[0];
  }

  /* ---------- 조회 ---------- */
  async function fetchMembers() {
    const { data, error } = await supabaseClient.from('members')
      .select('id, name, color, display_order').eq('is_active', true).order('display_order', { ascending: true });
    if (error) throw error; return data || [];
  }
  async function fetchCinemas() {
    const { data, error } = await supabaseClient.from('cinemas')
      .select('id, name, region, district, address, rental_cost, capacity, status, primary_contact_name, primary_contact_phone, primary_contact_email, summary, notes, is_archived, is_pinned, liked_by, created_at, updated_at, cinema_members ( member_id, responsibility, is_lead, display_order, members ( id, name, color ) ), cinema_screening_dates ( id, date_type, screening_date, start_time, end_time, note ), cinema_links ( id, link_type, label, url, display_order ), cinema_contact_logs ( id, member_id, contacted_at, contact_method, contact_person, result, note, next_follow_up_date, created_at, updated_at, members ( id, name, color ) )')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(c => ({
      id: c.id, name: c.name, region: c.region, district: c.district, address: c.address,
      rentalCost: c.rental_cost === null ? null : Number(c.rental_cost),
      capacity: c.capacity, status: c.status,
      contactName: c.primary_contact_name, contactPhone: c.primary_contact_phone, contactEmail: c.primary_contact_email,
      summary: c.summary, notes: c.notes, isArchived: !!c.is_archived,
      isPinned: !!c.is_pinned, likedBy: Array.isArray(c.liked_by) ? c.liked_by : [],
      createdAt: c.created_at, updatedAt: c.updated_at,
      members: (c.cinema_members || []).slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .map(m => ({ memberId: m.member_id, name: (m.members || {}).name || '(알 수 없음)', color: (m.members || {}).color || '#9a8f95', isLead: !!m.is_lead, responsibility: m.responsibility })),
      dates: (c.cinema_screening_dates || []).slice().sort((a, b) => String(a.screening_date).localeCompare(String(b.screening_date)))
        .map(d => ({ id: d.id, dateType: d.date_type, date: d.screening_date, startTime: d.start_time, endTime: d.end_time, note: d.note })),
      links: (c.cinema_links || []).slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .map(l => ({ id: l.id, linkType: l.link_type, label: l.label, url: l.url })),
      logs: (c.cinema_contact_logs || []).slice().sort((a, b) => String(b.contacted_at).localeCompare(String(a.contacted_at)))
        .map(g => ({ id: g.id, memberId: g.member_id, memberName: (g.members || {}).name || '', contactedAt: g.contacted_at, method: g.contact_method, contactPerson: g.contact_person, result: g.result, note: g.note, nextFollowUp: g.next_follow_up_date, createdAt: g.created_at, updatedAt: g.updated_at })),
    }));
  }

  async function reload() {
    if (!supabaseClient) return;
    const my = ++reqSeq; loading = true;
    try {
      const [ms, cs] = await Promise.all([fetchMembers(), fetchCinemas()]);
      if (my !== reqSeq) return;
      members = ms; cinemas = cs; loaded = true; errorMsg = null;
    } catch (e) {
      if (my !== reqSeq) return;
      console.error('[cinemas] 조회 실패', e); errorMsg = friendly(e);
    } finally {
      if (my === reqSeq) {
        loading = false; publishGlobals();
        if (typeof currentView !== 'undefined' && (currentView === 'cinemas' || currentView === 'calendar')) rerender();
      }
    }
  }
  function publishGlobals() {
    window.cinemaRecords = cinemas;
    // 캘린더용 평탄화(불가일 제외)
    const flat = [];
    cinemas.forEach(c => c.dates.forEach(d => {
      if (d.dateType === 'unavailable') return;
      flat.push({ cinemaId: c.id, name: c.name, region: c.region, address: c.address, dateType: d.dateType, dateTypeLabel: DATE_TYPE[d.dateType] || d.dateType, date: d.date, startTime: d.startTime });
    }));
    window.cinemaScreenings = flat;
  }

  /* ---------- 필터/정렬 ---------- */
  function applyFilters() {
    let arr = cinemas.slice();
    if (!filters.includeArchived) arr = arr.filter(c => !c.isArchived);
    if (filters.status) arr = arr.filter(c => c.status === filters.status);
    if (filters.region) arr = arr.filter(c => c.region === filters.region);
    if (filters.memberId) arr = arr.filter(c => c.members.some(m => m.memberId === Number(filters.memberId)));
    if (filters.costMin !== '') arr = arr.filter(c => c.rentalCost != null && c.rentalCost >= Number(filters.costMin));
    if (filters.costMax !== '') arr = arr.filter(c => c.rentalCost != null && c.rentalCost <= Number(filters.costMax));
    if (filters.dateFrom) arr = arr.filter(c => c.dates.some(d => d.date >= filters.dateFrom));
    if (filters.dateTo) arr = arr.filter(c => c.dates.some(d => d.date <= filters.dateTo));
    if (filters.search) {
      const q = filters.search.trim().toLowerCase();
      arr = arr.filter(c => [c.name, c.region, c.district, c.address, c.notes, c.summary, c.members.map(m => m.name).join(' ')]
        .some(v => String(v || '').toLowerCase().includes(q)));
    }
    const far = '9999-99-99';
    const by = {
      updated_desc: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
      created_desc: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
      name_asc: (a, b) => String(a.name).localeCompare(String(b.name), 'ko'),
      cost_asc: (a, b) => (a.rentalCost ?? Infinity) - (b.rentalCost ?? Infinity),
      cost_desc: (a, b) => (b.rentalCost ?? -Infinity) - (a.rentalCost ?? -Infinity),
      date_asc: (a, b) => (nearestDate(a) || far).localeCompare(nearestDate(b) || far),
    };
    arr.sort(by[filters.sort] || by.updated_desc);
    arr.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)); // 고정 항목 최상단(안정 정렬)
    return arr;
  }

  /* ---------- 렌더 ---------- */
  function render() {
    injectCss();
    addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', onExport));
    addTopbarAction(mkBtn('+ 영화관', 'btn-sm btn-primary', () => openForm(null)));
    const view = $('#view');
    if (!supabaseClient) { view.appendChild(el(`<div class="empty"><span class="empty-emoji">☁️</span>클라우드 미설정</div>`)); return; }
    if (errorMsg) {
      const box = el(`<div class="empty"><span class="empty-emoji">⚠️</span>영화관을 불러오지 못했어요.<br><span class="hint">${esc(errorMsg)}</span><br><br></div>`);
      box.appendChild(mkBtn('다시 시도', 'btn-sm btn-primary', () => { errorMsg = null; reload(); rerender(); }));
      view.appendChild(box); return;
    }
    if (!loaded) { view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏳</span>영화관을 불러오는 중…</div>`)); if (!loading) reload(); return; }

    const board = el('<div class="cin-board"></div>');
    board.innerHTML = summaryHtml() + toolbarHtml() + chipsHtml();
    const filtered = applyFilters();
    const totalPages = Math.max(1, Math.ceil(filtered.length / filters.pageSize));
    if (filters.page > totalPages) filters.page = totalPages;
    const start = (filters.page - 1) * filters.pageSize;
    const pageItems = filtered.slice(start, start + filters.pageSize);

    if (!cinemas.length) board.insertAdjacentHTML('beforeend', `<div class="empty"><span class="empty-emoji">🎞️</span>아직 등록된 영화관이 없습니다.<br>첫 번째 장소를 등록해 보세요.</div>`);
    else if (!filtered.length) board.insertAdjacentHTML('beforeend', `<div class="empty"><span class="empty-emoji">🔍</span>조건에 맞는 영화관이 없습니다.</div>`);
    else board.insertAdjacentHTML('beforeend', tableHtml(pageItems) + cardsHtml(pageItems) + pagerHtml(filtered.length, start, pageItems.length, totalPages));

    bindToolbar(board);
    board.addEventListener('click', onBoardClick);
    view.appendChild(board);
  }

  function summaryHtml() {
    const active = cinemas.filter(c => !c.isArchived);
    const cnt = (s) => active.filter(c => c.status === s).length;
    const cards = [
      ['', '전체', active.length],
      ['researching', '확인중', cnt('researching')],
      ['contacted', '연락완료', cnt('contacted')],
      ['available', '대관가능', cnt('available')],
      ['booked', '대관확정', cnt('booked')],
    ];
    return `<div class="cin-summary">${cards.map(([s, l, n]) =>
      `<div class="cin-sum ${filters.status === s && s ? 'active' : ''}" data-action="sum" data-status="${s}"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>`;
  }
  function toolbarHtml() {
    const regionOpts = ['<option value="">지역 전체</option>'].concat((typeof REGIONS !== 'undefined' ? REGIONS : []).map(r => `<option value="${esc(r)}" ${filters.region === r ? 'selected' : ''}>${esc(r)}</option>`)).join('');
    const memberOpts = ['<option value="">담당자 전체</option>'].concat(members.map(m => `<option value="${m.id}" ${String(filters.memberId) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`)).join('');
    const sortOpts = [['updated_desc', '최근 수정순'], ['created_desc', '최근 등록순'], ['name_asc', '이름순'], ['cost_asc', '대관료 낮은순'], ['cost_desc', '대관료 높은순'], ['date_asc', '가까운 일정순']]
      .map(([v, l]) => `<option value="${v}" ${filters.sort === v ? 'selected' : ''}>${l}</option>`).join('');
    return `<div class="cin-toolbar">
      <input class="cin-search" type="search" placeholder="이름·지역·주소·담당자 검색" value="${esc(filters.search)}" data-role="search" />
      <select data-role="status"><option value="">상태 전체</option>${Object.keys(STATUS).map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}</select>
      <select data-role="region">${regionOpts}</select>
      <select data-role="member">${memberOpts}</select>
      <select data-role="sort">${sortOpts}</select>
      <button class="btn btn-sm" data-action="more-filter">상세 필터</button>
      <select data-role="pagesize">${[10, 20, 50].map(n => `<option value="${n}" ${filters.pageSize === n ? 'selected' : ''}>${n}개</option>`).join('')}</select>
    </div>`;
  }
  function chipsHtml() {
    const chips = [];
    if (filters.search) chips.push(['검색: ' + filters.search, 'search']);
    if (filters.status) chips.push(['상태: ' + statusLabel(filters.status), 'status']);
    if (filters.region) chips.push(['지역: ' + filters.region, 'region']);
    if (filters.memberId) { const m = members.find(x => x.id === Number(filters.memberId)); chips.push(['담당자: ' + (m ? m.name : filters.memberId), 'member']); }
    if (filters.costMin !== '' || filters.costMax !== '') chips.push([`대관료: ${filters.costMin || 0}~${filters.costMax || '∞'}`, 'cost']);
    if (filters.dateFrom || filters.dateTo) chips.push([`일정: ${filters.dateFrom || ''}~${filters.dateTo || ''}`, 'date']);
    if (filters.includeArchived) chips.push(['보관 포함', 'archived']);
    if (!chips.length) return '';
    return `<div class="cin-fchips">${chips.map(([l, k]) => `<span class="cin-fchip">${esc(l)}<button data-action="clear-filter" data-key="${k}">✕</button></span>`).join('')}<button class="btn btn-sm btn-ghost" data-action="clear-all">전체 초기화</button></div>`;
  }
  function linksInline(c) {
    return c.links.slice(0, 3).map(l => `<a class="cin-linkchip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}" data-action="open-link">🔗<span>${esc(l.label || domainOf(l.url))}</span></a>`).join(' ');
  }
  function tableHtml(items) {
    const rows = items.map(c => {
      const nd = nearestDate(c); const lead = c.members.find(m => m.isLead) || c.members[0];
      return `<tr class="cin-row" data-action="open" data-id="${c.id}">
        <td>${c.isPinned ? '📌 ' : ''}<b>${esc(c.name)}</b>${c.isArchived ? ' <span class="tag tag-soft">보관</span>' : ''}</td>
        <td>${esc(c.region || '')}${c.district ? ' ' + esc(c.district) : ''}</td>
        <td class="amt">${costText(c.rentalCost)}</td>
        <td><span class="tag" style="background:${statusColor(c.status)};color:${textColorOn(statusColor(c.status))}">${statusLabel(c.status)}</span></td>
        <td>${nd ? fmtDate(nd) : '-'}</td>
        <td>${c.members.map(m => esc(m.name)).join(', ') || '-'}</td>
        <td onclick="event.stopPropagation()">${linksInline(c) || '-'}</td>
        <td>${c.updatedAt ? String(c.updatedAt).slice(0, 10) : ''}</td>
        <td>${actionsHtml(c)}</td>
      </tr>`;
    }).join('');
    return `<div class="cin-table-wrap table-scroll"><table class="data">
      <thead><tr><th>이름</th><th>지역</th><th style="text-align:right">대관료</th><th>상태</th><th>가까운 일정</th><th>담당자</th><th>링크</th><th>수정일</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  function cardsHtml(items) {
    return `<div class="cin-cards">${items.map(c => {
      const nd = nearestDate(c); const lead = c.members.find(m => m.isLead) || c.members[0];
      return `<div class="cin-card" data-action="open" data-id="${c.id}">
        <div class="nm">${c.isPinned ? '📌 ' : ''}${esc(c.name)}${c.isArchived ? ' <span class="tag tag-soft">보관</span>' : ''} <span class="tag" style="background:${statusColor(c.status)};color:${textColorOn(statusColor(c.status))}">${statusLabel(c.status)}</span></div>
        <div class="mt">
          <span>📍 ${esc(c.region || '')}${c.address ? ' · ' + esc(c.address) : ''}</span>
          <span>💵 ${costText(c.rentalCost)}</span>
          ${nd ? `<span>🎬 ${fmtDate(nd)}</span>` : ''}
          ${lead ? `<span>👤 ${esc(lead.name)}</span>` : ''}
        </div>
        <div class="mt" style="justify-content:space-between;margin-top:8px">
          <span onclick="event.stopPropagation()">${linksInline(c)}</span>
          ${actionsHtml(c)}
        </div>
      </div>`;
    }).join('')}</div>`;
  }
  function pagerHtml(total, start, shown, totalPages) {
    let bar = '';
    if (totalPages > 1) {
      const b = (label, page, dis, act) => `<button class="btn btn-sm ${act ? 'btn-primary' : ''}" ${dis ? 'disabled' : ''} data-action="page" data-page="${page}">${label}</button>`;
      let s = Math.max(1, filters.page - 2), e = Math.min(totalPages, s + 4); s = Math.max(1, e - 4);
      let nums = ''; for (let p = s; p <= e; p++) nums += b(p, p, false, p === filters.page);
      bar = b('‹', filters.page - 1, filters.page <= 1) + nums + b('›', filters.page + 1, filters.page >= totalPages);
    }
    return `<div class="cin-pager"><span class="hint">전체 ${total}곳 · ${total ? start + 1 : 0}–${start + shown} · 페이지 ${filters.page}/${totalPages}</span></div><div class="cin-pager">${bar}</div>`;
  }

  /* ---------- 툴바 바인딩 ---------- */
  function bindToolbar(board) {
    const q = (sel) => board.querySelector(sel);
    const reset = () => { filters.page = 1; };
    const search = q('[data-role=search]');
    if (search) search.addEventListener('input', () => { filters.search = search.value; reset(); rerender(); setTimeout(() => { const s2 = $('#view [data-role=search]'); if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); } }, 0); });
    const bindSel = (role, key, num) => { const s = q(`[data-role=${role}]`); if (s) s.addEventListener('change', () => { filters[key] = num ? Number(s.value) || (s.value === '' ? '' : s.value) : s.value; reset(); rerender(); }); };
    bindSel('status', 'status'); bindSel('region', 'region'); bindSel('member', 'memberId'); bindSel('sort', 'sort');
    const ps = q('[data-role=pagesize]'); if (ps) ps.addEventListener('change', () => { filters.pageSize = Number(ps.value); reset(); rerender(); });
  }

  /* ---------- 보드 클릭(위임) ---------- */
  function onBoardClick(e) {
    if (e.target.closest('a.cin-linkchip')) return; // 링크 기본동작
    const t = e.target.closest('[data-action]'); if (!t) return;
    const action = t.dataset.action;
    if (action === 'sum') { filters.status = t.dataset.status || ''; filters.page = 1; rerender(); return; }
    if (action === 'more-filter') { openFilterModal(); return; }
    if (action === 'clear-all') { Object.assign(filters, { search: '', status: '', region: '', memberId: '', costMin: '', costMax: '', dateFrom: '', dateTo: '', includeArchived: false, page: 1 }); rerender(); return; }
    if (action === 'clear-filter') {
      const k = t.dataset.key;
      if (k === 'cost') { filters.costMin = ''; filters.costMax = ''; }
      else if (k === 'date') { filters.dateFrom = ''; filters.dateTo = ''; }
      else if (k === 'member') filters.memberId = '';
      else if (k === 'archived') filters.includeArchived = false;
      else filters[k] = '';
      filters.page = 1; rerender(); return;
    }
    if (action === 'page') { filters.page = Number(t.dataset.page); rerender(); return; }
    if (action === 'like') { const c = cinemas.find(x => x.id === Number(t.dataset.id)); if (c) toggleLike(c); return; }
    if (action === 'pin') { const c = cinemas.find(x => x.id === Number(t.dataset.id)); if (c) togglePin(c); return; }
    if (action === 'open') { const c = cinemas.find(x => x.id === Number(t.dataset.id)); if (c) openDetail(c); return; }
  }

  /* ---------- 상세 필터 모달 ---------- */
  function openFilterModal() {
    const form = el(`<form>
      <div class="field-row">
        <div class="field"><label>대관료 최소</label><input name="cmin" type="number" min="0" value="${esc(filters.costMin)}" /></div>
        <div class="field"><label>대관료 최대</label><input name="cmax" type="number" min="0" value="${esc(filters.costMax)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>일정 시작</label><input name="dfrom" type="date" value="${esc(filters.dateFrom)}" /></div>
        <div class="field"><label>일정 종료</label><input name="dto" type="date" value="${esc(filters.dateTo)}" /></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" name="arch" ${filters.includeArchived ? 'checked' : ''} /> 보관된 장소 포함</label>
    </form>`);
    openModal({
      title: '상세 필터', body: form, footer: [
        mkBtn('취소', 'btn-ghost', closeModal),
        mkBtn('적용', 'btn-primary', () => {
          filters.costMin = form.cmin.value; filters.costMax = form.cmax.value;
          filters.dateFrom = form.dfrom.value; filters.dateTo = form.dto.value;
          filters.includeArchived = form.arch.checked; filters.page = 1;
          closeModal(); rerender();
        }),
      ],
    });
  }

  /* ---------- 상세 보기 ---------- */
  function openDetail(c) {
    currentDetailId = c.id;
    const body = el('<div></div>');
    const dt = (d) => `${DATE_TYPE[d.dateType] || d.dateType} · ${fmtDate(d.date)}${d.startTime ? ' ' + String(d.startTime).slice(0, 5) : ''}${d.endTime ? '~' + String(d.endTime).slice(0, 5) : ''}${d.note ? ' · ' + esc(d.note) : ''}`;
    const today = todayStr();
    body.innerHTML = `
      <div class="cin-sec"><span class="tag" style="background:${statusColor(c.status)};color:${textColorOn(statusColor(c.status))}">${statusLabel(c.status)}</span>${c.isArchived ? ' <span class="tag tag-soft">보관됨</span>' : ''}</div>
      <div class="cin-sec"><h4>기본 정보</h4>
        <div class="hint">📍 ${esc([c.region, c.district, c.address].filter(Boolean).join(' ') || '-')}</div>
        <div class="hint">💵 대관료 ${costText(c.rentalCost)} · 👥 수용 ${c.capacity ?? '-'}</div>
        ${c.contactName || c.contactPhone || c.contactEmail ? `<div class="hint">☎ ${esc(c.contactName || '')} ${esc(c.contactPhone || '')} ${esc(c.contactEmail || '')}</div>` : ''}
        ${c.summary ? `<div style="margin-top:4px">${esc(c.summary)}</div>` : ''}
      </div>
      <div class="cin-sec"><h4>담당자</h4>${c.members.length ? c.members.map(m => `<span class="tag" style="background:${m.color};color:${textColorOn(m.color)}">${esc(m.name)}${m.isLead ? ' ⭐' : ''}</span>`).join(' ') : '<span class="hint">없음</span>'}</div>
      <div class="cin-sec"><h4>일정</h4>${c.dates.length ? c.dates.map(d => `<div class="hint">🎬 ${dt(d)}</div>`).join('') : '<span class="hint">없음</span>'}</div>
      <div class="cin-sec"><h4>외부 링크</h4>${c.links.length ? c.links.map(l => `<a class="cin-linkchip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.url)}">🔗<span>${esc((LINK_TYPE[l.linkType] || '') + ' · ' + (l.label || domainOf(l.url)))}</span></a>`).join(' ') : '<span class="hint">없음</span>'}</div>
      ${c.notes ? `<div class="cin-sec"><h4>메모</h4><div style="white-space:pre-wrap">${esc(c.notes)}</div></div>` : ''}
      <div class="cin-sec"><h4>연락 이력</h4><div id="cinLogs"></div>
        <button class="btn btn-sm btn-primary" id="cinAddLog">+ 연락 기록</button></div>`;
    const logsBox = $('#cinLogs', body);
    if (!c.logs.length) logsBox.innerHTML = '<div class="hint">연락 기록이 없습니다.</div>';
    else c.logs.forEach(g => {
      const overdue = g.nextFollowUp && g.nextFollowUp < today;
      const row = el(`<div class="cin-log ${overdue ? 'overdue' : ''}">
        <div style="font-size:12.5px"><b>${esc(METHOD[g.method] || g.method)}</b> · ${String(g.contactedAt).slice(0, 16).replace('T', ' ')} ${g.memberName ? '· ' + esc(g.memberName) : ''}</div>
        ${g.contactPerson || g.result ? `<div class="hint">상대: ${esc(g.contactPerson || '-')} · 결과: ${esc(g.result || '-')}</div>` : ''}
        <div style="white-space:pre-wrap;font-size:13px">${esc(g.note)}</div>
        ${g.nextFollowUp ? `<div class="hint" ${overdue ? 'style="color:#ff7300"' : ''}>다음 연락: ${fmtDate(g.nextFollowUp)}${overdue ? ' (지남)' : ''}</div>` : ''}
        <div style="margin-top:3px"><button class="btn btn-sm btn-icon" data-e>편집</button> <button class="btn btn-sm btn-icon btn-ghost" data-d>삭제</button></div>
      </div>`);
      row.querySelector('[data-e]').addEventListener('click', () => openLogForm(c, g));
      row.querySelector('[data-d]').addEventListener('click', () => confirmDelete('이 연락 기록을 삭제할까요?', async () => {
        try { const { error } = await supabaseClient.from('cinema_contact_logs').delete().eq('id', g.id); if (error) throw error; toast('삭제되었습니다'); await refreshDetail(); } catch (e) { console.error(e); toast('삭제 실패: ' + friendly(e)); }
      }));
      logsBox.appendChild(row);
    });
    $('#cinAddLog', body).addEventListener('click', () => openLogForm(c, null));

    const footer = [
      mkBtn(c.isArchived ? '보관 해제' : '보관', 'btn-ghost', () => toggleArchive(c)),
      mkBtn('삭제', 'btn-danger', () => onDeleteCinema(c)),
      mkBtn('편집', 'btn-primary', () => openForm(c)),
      mkBtn('닫기', 'btn-ghost', () => { currentDetailId = null; closeModal(); }),
    ];
    openModal({ title: c.name, body, footer, onClose: () => { currentDetailId = null; } });
  }
  async function refreshDetail() {
    const id = currentDetailId;
    await reload();
    if (id) { const c = cinemas.find(x => x.id === id); if (c) openDetail(c); }
  }

  /* ---------- 등록/수정 폼 ---------- */
  function openForm(existing) {
    if (!members.length) { toast('팀원을 불러오지 못했습니다.'); return; }
    const c = existing || {};
    const form = el(`<form id="cinForm">
      <div class="field"><label>영화관 이름 <span class="req">*</span></label><input name="name" value="${esc(c.name || '')}" required /></div>
      <div class="field-row">
        <div class="field"><label>지역</label><select name="region"><option value="">-</option>${(typeof REGIONS !== 'undefined' ? REGIONS : []).map(r => `<option ${c.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        <div class="field"><label>세부 지역</label><input name="district" value="${esc(c.district || '')}" /></div>
      </div>
      <div class="field"><label>주소</label><input name="address" value="${esc(c.address || '')}" /></div>
      <div class="field-row">
        <div class="field"><label>대관료(원)</label><input name="cost" type="number" min="0" value="${c.rentalCost ?? ''}" /></div>
        <div class="field"><label>수용 인원</label><input name="cap" type="number" min="1" value="${c.capacity ?? ''}" /></div>
      </div>
      <div class="field"><label>상태 <span class="req">*</span></label>
        <select name="status">${Object.keys(STATUS).map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS[s].label}</option>`).join('')}</select></div>
      <div class="field-row">
        <div class="field"><label>연락처 이름</label><input name="cname" value="${esc(c.contactName || '')}" /></div>
        <div class="field"><label>전화</label><input name="cphone" value="${esc(c.contactPhone || '')}" /></div>
      </div>
      <div class="field"><label>이메일</label><input name="cemail" type="email" value="${esc(c.contactEmail || '')}" /></div>
      <div class="field"><label>요약</label><input name="summary" value="${esc(c.summary || '')}" /></div>
      <div class="field"><label>담당자 <span class="req">*</span> <span class="hint">(여러 명)</span></label><div class="pill-select" id="cinMembers"></div></div>
      <div class="field"><label>일정</label><div id="cinDates"></div><button type="button" class="btn btn-sm" id="cinAddDate">+ 일정 추가</button></div>
      <div class="field"><label>외부 링크</label><div id="cinLinks"></div><button type="button" class="btn btn-sm" id="cinAddLink">+ 링크 추가</button></div>
      <div class="field"><label>상세 메모</label><textarea name="notes">${esc(c.notes || '')}</textarea></div>
    </form>`);

    const initNames = existing ? c.members.map(m => m.name) : (members[0] ? [members[0].name] : []);
    const getMembers = pillMultiSelect($('#cinMembers', form), members.map(m => [m.name, m.color || '#9a8f95']), initNames);

    // 일정 리페터 (모달 폭 안에서 줄바꿈)
    const datesBox = $('#cinDates', form);
    const addDateRow = (d) => {
      const row = el(`<div class="cin-repeat">
        <select data-k="type">${Object.keys(DATE_TYPE).map(k => `<option value="${k}" ${d && d.dateType === k ? 'selected' : ''}>${DATE_TYPE[k]}</option>`).join('')}</select>
        <input data-k="date" type="date" value="${d ? esc(d.date) : ''}" />
        <input data-k="start" type="time" value="${d && d.startTime ? String(d.startTime).slice(0, 5) : ''}" />
        <input data-k="end" type="time" value="${d && d.endTime ? String(d.endTime).slice(0, 5) : ''}" />
        <button type="button" class="btn btn-sm btn-ghost rm" data-rm>✕</button></div>`);
      row.querySelector('[data-rm]').addEventListener('click', () => row.remove());
      datesBox.appendChild(row);
    };
    (existing ? c.dates : []).forEach(addDateRow);
    $('#cinAddDate', form).addEventListener('click', () => addDateRow(null));

    // 링크 리페터
    const linksBox = $('#cinLinks', form);
    const addLinkRow = (l) => {
      const row = el(`<div class="cin-repeat">
        <select data-k="type">${Object.keys(LINK_TYPE).map(k => `<option value="${k}" ${l && l.linkType === k ? 'selected' : ''}>${LINK_TYPE[k]}</option>`).join('')}</select>
        <input data-k="label" placeholder="표시 이름" value="${l ? esc(l.label) : ''}" />
        <input data-k="url" placeholder="https://" value="${l ? esc(l.url) : ''}" />
        <button type="button" class="btn btn-sm btn-ghost rm" data-rm>✕</button></div>`);
      row.querySelector('[data-rm]').addEventListener('click', () => row.remove());
      linksBox.appendChild(row);
    };
    (existing ? c.links : []).forEach(addLinkRow);
    $('#cinAddLink', form).addEventListener('click', () => addLinkRow(null));

    const footer = [mkBtn('취소', 'btn-ghost', closeModal)];
    const saveBtn = mkBtn(existing ? '저장' : '등록', 'btn-primary', () => submit(saveBtn, form, existing, { getMembers, datesBox, linksBox }));
    footer.push(saveBtn);
    openModal({ title: existing ? '영화관 편집' : '새 영화관 등록', body: form, footer });
  }

  function collectRows(box, mapFn) { return [...box.children].map(mapFn).filter(Boolean); }

  async function submit(btn, form, existing, ctx) {
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) return toast('영화관 이름을 입력해주세요');
    const chosen = ctx.getMembers();
    const memberIds = chosen.map(n => (members.find(m => m.name === n) || {}).id).filter(Boolean);
    if (!memberIds.length) return toast('담당자를 한 명 이상 선택해주세요');

    // 일정 수집·검증
    let dates;
    try {
      dates = collectRows(ctx.datesBox, (r) => {
        const g = (k) => r.querySelector(`[data-k=${k}]`).value;
        const date = g('date'); if (!date) return null;
        const start = g('start') || null, end = g('end') || null;
        if (start && end && end <= start) throw new Error('일정 종료 시간이 시작보다 빨라요');
        return { date_type: g('type'), screening_date: date, start_time: start, end_time: end };
      });
    } catch (e) { return toast(e.message); }
    // 링크 수집·검증
    let links;
    try {
      links = collectRows(ctx.linksBox, (r) => {
        const g = (k) => r.querySelector(`[data-k=${k}]`).value;
        const rawUrl = g('url').trim(); if (!rawUrl) return null;
        const norm = normalizeLink(rawUrl); if (!norm.ok) throw new Error('링크는 http(s):// 형식이어야 합니다');
        return { link_type: g('type'), label: (g('label').trim() || domainOf(norm.value)), url: norm.value };
      });
    } catch (e) { return toast(e.message); }

    const base = {
      name, region: fd.get('region') || null, district: String(fd.get('district') || '').trim() || null,
      address: String(fd.get('address') || '').trim() || null,
      rental_cost: fd.get('cost') === '' ? null : Number(fd.get('cost')),
      capacity: fd.get('cap') === '' ? null : Number(fd.get('cap')),
      status: fd.get('status'),
      primary_contact_name: String(fd.get('cname') || '').trim() || null,
      primary_contact_phone: String(fd.get('cphone') || '').trim() || null,
      primary_contact_email: String(fd.get('cemail') || '').trim() || null,
      summary: String(fd.get('summary') || '').trim() || null,
      notes: String(fd.get('notes') || '').trim() || null,
    };

    btn.disabled = true;
    try {
      let cinemaId;
      if (existing) {
        const { error } = await supabaseClient.from('cinemas').update({ ...base, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw error;
        cinemaId = existing.id;
        // 관계는 기존 삭제 후 재삽입(가독성 우선)
        for (const tbl of ['cinema_members', 'cinema_screening_dates', 'cinema_links']) {
          const { error: eDel } = await supabaseClient.from(tbl).delete().eq('cinema_id', cinemaId);
          if (eDel) throw new Error(`${tbl} 초기화 실패: ${friendly(eDel)}`);
        }
      } else {
        const { data, error } = await supabaseClient.from('cinemas').insert(base).select('id').single();
        if (error) throw error;
        cinemaId = data.id;
      }
      // 담당자 (대표 담당자 개념 제거 → is_lead 사용 안 함)
      const mrows = memberIds.map((mid, i) => ({ cinema_id: cinemaId, member_id: mid, is_lead: false, display_order: i }));
      const { error: em } = await supabaseClient.from('cinema_members').insert(mrows);
      if (em) throw new Error(`기본 정보는 저장됐지만 담당자 연결 실패: ${friendly(em)}`);
      // 일정
      if (dates.length) { const { error: ed } = await supabaseClient.from('cinema_screening_dates').insert(dates.map(d => ({ ...d, cinema_id: cinemaId }))); if (ed) throw new Error(`일정 저장 실패: ${friendly(ed)}`); }
      // 링크
      if (links.length) { const { error: el2 } = await supabaseClient.from('cinema_links').insert(links.map((l, i) => ({ ...l, cinema_id: cinemaId, display_order: i }))); if (el2) throw new Error(`링크 저장 실패: ${friendly(el2)}`); }

      closeModal();
      toast(existing ? '수정되었습니다' : '영화관이 등록되었습니다');
      currentDetailId = existing ? existing.id : null;
      if (existing) await refreshDetail(); else await reload();
    } catch (e) {
      console.error('[cinemas] 저장 실패', e);
      toast('저장 실패: ' + (e.message || friendly(e)));
      btn.disabled = false;
    }
  }

  /* ---------- 연락 기록 폼 ---------- */
  function openLogForm(cinema, existing) {
    const g = existing || {};
    const form = el(`<form>
      <div class="field-row">
        <div class="field"><label>방식 <span class="req">*</span></label><select name="method">${Object.keys(METHOD).map(k => `<option value="${k}" ${g.method === k ? 'selected' : ''}>${METHOD[k]}</option>`).join('')}</select></div>
        <div class="field"><label>담당 팀원</label><select name="member"><option value="">-</option>${members.map(m => `<option value="${m.id}" ${g.memberId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>상대 담당자</label><input name="person" value="${esc(g.contactPerson || '')}" /></div>
        <div class="field"><label>결과</label><input name="result" value="${esc(g.result || '')}" /></div>
      </div>
      <div class="field"><label>내용 <span class="req">*</span></label><textarea name="note">${esc(g.note || '')}</textarea></div>
      <div class="field"><label>다음 연락 예정일</label><input name="follow" type="date" value="${esc(g.nextFollowUp || '')}" /></div>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="setStatus" /> 저장 후 상태를 '연락완료'로 변경</label>
    </form>`);
    const saveBtn = mkBtn('저장', 'btn-primary', async () => {
      const note = String(form.note.value || '').trim();
      if (!note) return toast('연락 내용을 입력해주세요');
      const payload = {
        cinema_id: cinema.id, contact_method: form.method.value,
        member_id: form.member.value ? Number(form.member.value) : null,
        contact_person: form.person.value.trim() || null, result: form.result.value.trim() || null,
        note, next_follow_up_date: form.follow.value || null,
      };
      saveBtn.disabled = true;
      try {
        if (existing) { const { error } = await supabaseClient.from('cinema_contact_logs').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id); if (error) throw error; }
        else { const { error } = await supabaseClient.from('cinema_contact_logs').insert(payload); if (error) throw error; }
        if (form.setStatus.checked) { const { error: es } = await supabaseClient.from('cinemas').update({ status: 'contacted', updated_at: new Date().toISOString() }).eq('id', cinema.id); if (es) console.error('상태 변경 실패', es); }
        toast(existing ? '수정되었습니다' : '연락 기록이 추가되었습니다');
        await refreshDetail();
      } catch (e) { console.error('[cinemas] 연락기록 저장 실패', e); toast('저장 실패: ' + friendly(e)); saveBtn.disabled = false; }
    });
    openModal({ title: existing ? '연락 기록 편집' : '연락 기록 추가', body: form, footer: [mkBtn('취소', 'btn-ghost', () => openDetail(cinema)), saveBtn] });
  }

  /* ---------- 보관 / 삭제 ---------- */
  async function toggleArchive(c) {
    try {
      const { error } = await supabaseClient.from('cinemas').update({ is_archived: !c.isArchived, updated_at: new Date().toISOString() }).eq('id', c.id);
      if (error) throw error;
      toast(c.isArchived ? '보관 해제되었습니다' : '보관되었습니다');
      currentDetailId = null; closeModal(); await reload();
    } catch (e) { console.error(e); toast('실패: ' + friendly(e)); }
  }
  function onDeleteCinema(c) {
    confirmDelete(`'${c.name}'을(를) 완전히 삭제할까요? 연락 이력 ${c.logs.length}건 · 일정 ${c.dates.length}건 · 링크 ${c.links.length}건도 함께 삭제됩니다.`, async () => {
      try { const { error } = await supabaseClient.from('cinemas').delete().eq('id', c.id); if (error) throw error; toast('삭제되었습니다'); currentDetailId = null; closeModal(); await reload(); }
      catch (e) { console.error(e); toast('삭제 실패: ' + friendly(e)); }
    });
  }

  /* ---------- 좋아요(기기 기준) / 상단 고정 ---------- */
  const likeCount = (c) => (c.likedBy || []).length;
  const hasLiked = (c) => (c.likedBy || []).includes(typeof deviceId === 'function' ? deviceId() : '');
  function actionsHtml(c) { // 표/카드 공용 ❤·📌 버튼 (기존 like-btn 스타일 재사용)
    return `<span class="cin-actbtns" onclick="event.stopPropagation()">
      <button class="like-btn ${hasLiked(c) ? 'liked' : ''}" data-action="like" data-id="${c.id}" title="추천">❤ <span>${likeCount(c)}</span></button>
      <button class="like-btn ${c.isPinned ? 'liked' : ''}" data-action="pin" data-id="${c.id}" title="상단 고정">📌</button>
    </span>`;
  }
  async function toggleLike(c) {
    const me = typeof deviceId === 'function' ? deviceId() : '';
    const set = new Set(c.likedBy || []);
    if (set.has(me)) set.delete(me); else set.add(me);
    const arr = [...set];
    try {
      const { error } = await supabaseClient.from('cinemas').update({ liked_by: arr }).eq('id', c.id);
      if (error) throw error;
      c.likedBy = arr; rerender();
    } catch (e) { console.error('[cinemas] 추천 실패', e); toast('추천 실패: ' + friendly(e)); }
  }
  async function togglePin(c) {
    try {
      const { error } = await supabaseClient.from('cinemas').update({ is_pinned: !c.isPinned }).eq('id', c.id);
      if (error) throw error;
      c.isPinned = !c.isPinned; rerender(); toast(c.isPinned ? '상단에 고정했어요' : '고정을 해제했어요');
    } catch (e) { console.error('[cinemas] 고정 실패', e); toast('고정 실패: ' + friendly(e)); }
  }

  /* ---------- 엑셀 (영화관 + 연락이력 + 일정 3시트) ---------- */
  function onExport() {
    if (!cinemas.length) return toast('내보낼 데이터가 없어요');
    const linkOf = (c, type) => (c.links.find(l => l.linkType === type) || {}).url || '';
    const cinRows = cinemas.map(c => ({
      영화관: c.name, 지역: c.region || '', 세부지역: c.district || '', 주소: c.address || '',
      대관료: c.rentalCost ?? '', 수용인원: c.capacity ?? '', 상태: statusLabel(c.status),
      담당자: c.members.map(m => m.name + (m.isLead ? '(대표)' : '')).join(', '),
      대표연락담당: c.contactName || '', 전화: c.contactPhone || '', 이메일: c.contactEmail || '',
      후보일: c.dates.filter(d => d.dateType === 'candidate').map(d => d.date).join(', '),
      확정일: c.dates.filter(d => d.dateType === 'confirmed').map(d => d.date).join(', '),
      홈페이지: linkOf(c, 'website'), 지도: linkOf(c, 'map'),
      기타링크: c.links.filter(l => !['website', 'map'].includes(l.linkType)).map(l => l.url).join(', '),
      메모: c.notes || '', 최근수정일: c.updatedAt ? String(c.updatedAt).slice(0, 10) : '',
    }));
    const logRows = [];
    cinemas.forEach(c => c.logs.forEach(g => logRows.push({
      영화관: c.name, 연락일시: String(g.contactedAt).slice(0, 16).replace('T', ' '), 방식: METHOD[g.method] || g.method,
      담당팀원: g.memberName || '', 상대담당자: g.contactPerson || '', 결과: g.result || '', 내용: g.note, 다음연락예정일: g.nextFollowUp || '',
    })));
    const dateRows = [];
    cinemas.forEach(c => c.dates.forEach(d => dateRows.push({
      영화관: c.name, 일정유형: DATE_TYPE[d.dateType] || d.dateType, 날짜: d.date,
      시작: d.startTime ? String(d.startTime).slice(0, 5) : '', 종료: d.endTime ? String(d.endTime).slice(0, 5) : '', 메모: d.note || '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(cinRows), '영화관');
    if (logRows.length) XLSX.utils.book_append_sheet(wb, sheetFrom(logRows), '연락이력');
    if (dateRows.length) XLSX.utils.book_append_sheet(wb, sheetFrom(dateRows), '일정');
    XLSX.writeFile(wb, `영화관목록_${stampToday()}.xlsx`);
    toast('엑셀 파일을 다운로드했어요');
  }

  /* ---------- 공개 API + 라우터 ---------- */
  window.loadCinemaData = reload;
  window.openCinemaDetail = (id) => { const c = cinemas.find(x => x.id === Number(id)); if (c) openDetail(c); };
  window.cinemaRecords = cinemas; window.cinemaScreenings = [];
  if (typeof VIEWS !== 'undefined' && VIEWS && VIEWS.cinemas) VIEWS.cinemas.render = render;
  else console.warn('[cinemas] VIEWS.cinemas 를 찾지 못했습니다 — 오버라이드 건너뜀');
})();
