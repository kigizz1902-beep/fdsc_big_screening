/* =========================================================
   캘린더 (Supabase 관계형 테이블 버전) — 홈 대시보드
   ---------------------------------------------------------
   데이터 소유 원칙(복제 금지 — 화면에서 JS 로 조합만 한다):
     · 캘린더에서 직접 등록한 일반 일정 → calendar_events   ← 이 모듈만 CRUD
     · 회의록 날짜 / 다음 미팅 예정일   → meeting_minutes    (meetings.js 의 window.minuteRecords 재사용)
     · 영화관 후보/가능/확정 일정       → cinema_screening_dates (cinemas.js 의 window.cinemaScreenings 재사용)
     · 작업 기록 날짜                   → timesheets          (timesheets.js 의 window.timesheetRecords 재사용)
   다른 테이블의 날짜를 calendar_events 에 INSERT 하지 않는다.

   · DB.events / localStorage / bigact 를 일반 일정 원본으로 쓰지 않음.
   · app.js 헬퍼(el,$,openModal,closeModal,mkBtn,confirmDelete,toast,addTopbarAction,
     rerender,esc,fmtDate,fmtDateShort,fmtRange,weekdayKo,todayStr,dateToStr,pad,
     textColorOn,pillSelect,weekRangeOf,todayInRange,minuteItemsOnDate,
     openDayTimestampsModal,exportCalendar,SECTORS,CINEMA_STATUS,MINUTE_COLOR,TS_COLOR,
     MONTHS,WEEKDAYS_KO,calIndex,VIEWS)와 supabase.js 의 supabaseClient 재사용.
   · 기존 renderCalendar/openEventModal 등 레거시 함수는 app.js 에 남기고
     VIEWS.calendar.render 만 대체한다 (다른 전환 기능과 동일한 패턴).

   상태 분리: 월간 이동(calIndex) ↔ 주간 이동(weekOffset) 은 서로 영향 없음.
   보안: 로그인 없음 — 앱 주소 + anon key 를 아는 사람은 일반 일정을 CRUD 할 수 있음.
   ========================================================= */
(function () {
  'use strict';

  /* event_type 코드 ↔ 화면 표시명 (색상은 app.js 의 SECTORS 에서 관리) */
  const TYPE_TO_LABEL = { meeting: '미팅', screening: '상영회', other: '기타', weekly_goal: '이번주 목표' };
  const LABEL_TO_TYPE = { '미팅': 'meeting', '상영회': 'screening', '기타': 'other', '이번주 목표': 'weekly_goal' };

  /* 월간 캘린더 기본 조회 범위 = MONTHS(2026-07 ~ 2026-12) 전체.
     주간 화살표로 이 범위를 벗어나면 조회 범위를 그만큼 넓혀 다시 가져온다. */
  const RANGE_START = `${MONTHS[0].y}-${pad(MONTHS[0].m + 1)}-01`;
  const RANGE_END = (() => {
    const L = MONTHS[MONTHS.length - 1];
    return `${L.y}-${pad(L.m + 1)}-${pad(new Date(L.y, L.m + 1, 0).getDate())}`;
  })();

  /* ---------- 캘린더 전용 상태 ---------- */
  let events = [];                          // 일반 일정 화면용 레코드
  let loaded = false, loading = false, errorMsg = null, reqSeq = 0;
  let weekOffset = 0;                       // 주간 일정 이동(0 = 이번 주) — 월간 calIndex 와 분리
  let weekSeq = 0;                          // 오래된 주간 비동기 응답이 최신 선택을 덮지 않도록
  let loadedStart = null, loadedEnd = null; // 현재 events 가 커버하는 날짜 범위

  function friendly(e) {
    const m = (e && (e.message || e.details || e.error_description)) || '';
    if (/relation .* does not exist|42P01|schema cache/i.test(m)) return '캘린더 테이블이 없습니다. sql/calendar_events.sql 을 먼저 실행하세요.';
    return m || '알 수 없는 오류';
  }

  /* 선택된 주(일~토) 범위 — 로컬 날짜 기준 (toISOString 사용 금지: KST 에서 하루 밀림) */
  function getWeekRange(offset = weekOffset) {
    const now = new Date();
    const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + offset * 7);
    const sat = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 6);
    return { start: dateToStr(sun), end: dateToStr(sat) };
  }

  /* 일반 일정이 특정 날짜를 포함하는가 (기간 일정 지원) */
  function onDate(e, dateStr) {
    const end = e.dateEnd || e.date;
    return e.date <= dateStr && dateStr <= end;
  }

  /* ---------- 조회 ---------- */
  /* 기간 겹침 기준: start_date <= rangeEnd AND coalesce(end_date, start_date) >= rangeStart */
  async function fetchEvents(rangeStart, rangeEnd) {
    const { data, error } = await supabaseClient.from('calendar_events')
      .select('id, title, event_type, start_date, end_date, start_time, memo, created_at, updated_at')
      .lte('start_date', rangeEnd)
      .or(`end_date.gte.${rangeStart},and(end_date.is.null,start_date.gte.${rangeStart})`)
      .order('start_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      type: r.event_type,
      sector: TYPE_TO_LABEL[r.event_type] || '기타',   // 화면 표시명(색상 키)
      name: r.title,
      date: r.start_date,
      dateEnd: r.end_date || '',
      time: r.start_time ? String(r.start_time).slice(0, 5) : '',
      memo: r.memo || '',
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  /* 캘린더 데이터 로드 — 월간 전체 범위 + 현재 선택 주를 합친 범위를 가져온다.
     회의록·영화관·타임시트는 각 모듈의 공통 조회(window.*Records)를 재사용하고
     여기서 중복 조회하지 않는다 (init 에서 선로딩, 각 저장 후 모듈이 갱신). */
  async function reload(opts = {}) {
    if (!supabaseClient) return;
    const wk = getWeekRange();
    const start = wk.start < RANGE_START ? wk.start : RANGE_START;
    const end = wk.end > RANGE_END ? wk.end : RANGE_END;
    const my = ++reqSeq;
    loading = true;
    try {
      const rows = await fetchEvents(start, end);
      if (my !== reqSeq) return;                 // 더 새로운 요청이 있으면 버림
      events = rows; loaded = true; errorMsg = null;
      loadedStart = start; loadedEnd = end;
    } catch (e) {
      if (my !== reqSeq) return;
      console.error('[calendar] 조회 실패', e);
      errorMsg = friendly(e);
    } finally {
      if (my === reqSeq) {
        loading = false;
        window.calendarEventRecords = events;    // 엑셀 백업(app.js eventsRows) 참조용
        if (!opts.skipRender && typeof currentView !== 'undefined' && currentView === 'calendar') rerender();
      }
    }
  }

  /* ---------- 화면용 통합 일정 모델 ----------
     여러 출처를 하나의 목록으로 조합만 한다(어떤 테이블에도 다시 저장하지 않음).
     key = sourceType:sourceId:date → 같은 원본 행이 두 번 렌더링되지 않게 함 */
  function dayItems(dateStr) {
    const seen = new Set();
    const items = [];
    const push = (it) => { if (!seen.has(it.key)) { seen.add(it.key); items.push(it); } };

    // 1) 일반 일정 (calendar_events)
    events
      .filter(e => onDate(e, dateStr))
      .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
      .forEach(e => push({
        key: `calendar_event:${e.id}:${dateStr}`,
        sourceType: 'calendar_event', sourceId: e.id, date: dateStr,
        label: (e.time && e.date === dateStr ? e.time + ' ' : '') + e.name,
        color: SECTORS[e.sector] || '#9a8f95',
        onClick: () => openDetail(e),
      }));

    // 2) 회의록 회의 날짜 / 다음 미팅 예정일 (meeting_minutes)
    minuteItemsOnDate(dateStr).forEach(it => push({
      key: `${it.kind === '회의' ? 'meeting_minute' : 'next_meeting'}:${it.minuteId}:${dateStr}`,
      sourceType: it.kind === '회의' ? 'meeting_minute' : 'next_meeting', sourceId: it.minuteId, date: dateStr,
      label: it.label, color: it.color,
      onClick: () => window.openMinuteDetailById && window.openMinuteDetailById(it.minuteId),
    }));

    // 3) 영화관 일정 (cinema_screening_dates — 기존과 동일하게 불가일 제외 목록 사용)
    (window.cinemaScreenings || []).filter(s => s.date === dateStr).forEach(s => push({
      key: `cinema_screening:${s.cinemaId}:${s.dateType}:${dateStr}`,
      sourceType: 'cinema_screening', sourceId: s.cinemaId, date: dateStr,
      label: `🎬 ${s.name} (${s.dateTypeLabel})`,
      color: CINEMA_STATUS['상영일정'],
      onClick: () => window.openCinemaDetail && window.openCinemaDetail(s.cinemaId),
    }));

    return items;
  }

  /* ---------- 렌더 ---------- */
  function render() {
    addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => exportCalendar()));
    addTopbarAction(mkBtn('+ 이벤트', 'btn-sm btn-primary', () => openForm(null, todayInRange())));

    const view = $('#view');
    if (!supabaseClient) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">☁️</span>클라우드 미설정 — supabase.js 의 URL/키를 확인하세요.</div>`));
      return;
    }
    if (errorMsg) {
      const box = el(`<div class="empty"><span class="empty-emoji">⚠️</span>캘린더를 불러오지 못했어요.<br><span class="hint">${esc(errorMsg)}</span><br><br></div>`);
      box.appendChild(mkBtn('다시 시도', 'btn-sm btn-primary', () => { errorMsg = null; reload(); rerender(); }));
      view.appendChild(box);
      return;
    }
    if (!loaded) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏳</span>캘린더를 불러오는 중…</div>`));
      if (!loading) reload();
      return;
    }

    const wrap = el('<div></div>');

    /* 월간 툴바 + 범례 (기존 디자인 그대로) */
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

    /* 주간 일정 골격 — 목록만 갱신할 수 있도록 컨테이너 분리 */
    wrap.appendChild(el(`
      <div class="week-section" id="weekSection">
        <div class="week-header">
          <h3 id="weekTitle">📌 이번 주 일정</h3>
          <div class="week-nav">
            <button class="btn btn-icon week-nav-btn" id="weekPrev" aria-label="이전 주 보기">‹</button>
            <span class="week-range" id="weekRange"></span>
            <button class="btn btn-icon week-nav-btn" id="weekNext" aria-label="다음 주 보기">›</button>
          </div>
        </div>
        <div id="weekList"></div>
      </div>`));

    view.appendChild(wrap);

    /* 월간 이동 — calIndex 만 변경 (주간 weekOffset 에 영향 없음) */
    $('#calPrev').addEventListener('click', () => { if (calIndex > 0) { calIndex--; drawMonth(); } });
    $('#calNext').addEventListener('click', () => { if (calIndex < MONTHS.length - 1) { calIndex++; drawMonth(); } });
    /* 주간 이동 — weekOffset 만 변경 (월간 calIndex 에 영향 없음), 주간 영역만 갱신 */
    $('#weekPrev').addEventListener('click', () => moveWeek(-1));
    $('#weekNext').addEventListener('click', () => moveWeek(1));

    drawMonth();
    drawWeek();
  }

  /* ---------- 월간 캘린더 (기존 디자인·동작 유지) ---------- */
  function drawMonth() {
    const grid = $('#calGrid');
    if (!grid) return;                             // 캘린더 화면이 아니면 무시
    const { y, m } = MONTHS[calIndex];
    $('#calMonth').textContent = `${y}년 ${m + 1}월`;
    $('#calPrev').style.opacity = calIndex === 0 ? .35 : 1;
    $('#calNext').style.opacity = calIndex === MONTHS.length - 1 ? .35 : 1;

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

        const combined = dayItems(dateStr);                                  // 통합 일정 모델
        const dayTs = (window.timesheetRecords || []).filter(t => t.date === dateStr);

        const evWrap = el('<div class="cal-events"></div>');
        combined.slice(0, 3).forEach(item => {
          const chip = el(`<button class="cal-ev" style="background:${item.color};color:${textColorOn(item.color)}">${esc(item.label)}</button>`);
          chip.addEventListener('click', (ev) => { ev.stopPropagation(); item.onClick(); });
          evWrap.appendChild(chip);
        });
        if (combined.length > 3) evWrap.appendChild(el(`<div class="cal-more">+${combined.length - 3}개 더</div>`));
        // 작업 기록(timesheets) — 클릭하면 그날 기록 모달 (기존 동작 그대로)
        if (dayTs.length) {
          const tsChip = el(`<button class="cal-ev" style="background:${TS_COLOR};color:#fff">⏱ 작업 ${dayTs.length}건</button>`);
          tsChip.addEventListener('click', (ev) => { ev.stopPropagation(); openDayTimestampsModal(dateStr); });
          evWrap.appendChild(tsChip);
        }
        cell.appendChild(evWrap);

        cell.addEventListener('click', () => openForm(null, dateStr));       // 빈 날짜 → 일반 이벤트 등록
      }
      grid.appendChild(cell);
    });
  }

  /* ---------- 주간 일정 (좌우 이동) ---------- */
  async function moveWeek(delta) {
    weekOffset += delta;
    const my = ++weekSeq;
    const wk = getWeekRange();
    // 선택 주가 이미 조회된 범위 안이면 목록만 다시 그림 (페이지 전체 재렌더 없음)
    if (loadedStart && wk.start >= loadedStart && wk.end <= loadedEnd) { drawWeek(); return; }
    // 범위 밖(월간 범위 이전/이후 주) → 조회 범위를 넓혀 다시 가져온 뒤 주간만 갱신
    drawWeek({ loadingHint: true });
    await reload({ skipRender: true });
    if (my !== weekSeq) return;                    // 그 사이 또 이동했으면 버림
    drawWeek();
    drawMonth();                                   // 월간도 같은 events 배열을 쓰므로 함께 최신화
  }

  function drawWeek(opts = {}) {
    const listBox = $('#weekList');
    if (!listBox) return;                          // 캘린더 화면이 아니면 무시
    const { start: ws, end: we } = getWeekRange();
    $('#weekTitle').textContent = weekOffset === 0 ? '📌 이번 주 일정' : '📌 주간 일정';
    $('#weekRange').textContent = `${fmtDateShort(ws)} ~ ${fmtDateShort(we)}`;
    listBox.innerHTML = '';
    if (opts.loadingHint) {
      listBox.appendChild(el('<div class="empty" style="padding:26px 20px">불러오는 중…</div>'));
      return;
    }

    const today = todayStr();
    const seen = new Set();
    const items = [];
    const push = (key, it) => { if (!seen.has(key)) { seen.add(key); items.push(it); } };

    // 일반 일정 — 선택 주와 일부라도 겹치면 표시 (이전 주부터 이어지는 기간 일정은 주 시작일에 걸어서)
    events.forEach(e => {
      const end = e.dateEnd || e.date;
      if (e.date <= we && end >= ws) {
        const showDate = e.date >= ws ? e.date : ws;
        push(`calendar_event:${e.id}`, {
          date: showDate, time: e.time || '', label: e.name,
          sub: e.dateEnd && e.dateEnd !== e.date ? `${fmtDateShort(e.date)} ~ ${fmtDateShort(e.dateEnd)}` : (e.time || '종일'),
          color: SECTORS[e.sector] || '#9a8f95', onClick: () => openDetail(e),
        });
      }
    });
    // 영화관 일정 (기존과 동일한 출처·클릭 동작)
    (window.cinemaScreenings || []).forEach(s => {
      if (s.date >= ws && s.date <= we) {
        push(`cinema_screening:${s.cinemaId}:${s.dateType}:${s.date}`, {
          date: s.date, time: s.startTime ? String(s.startTime).slice(0, 5) : '',
          label: `🎬 ${s.name} (${s.dateTypeLabel})`, sub: s.region || s.address || '',
          color: CINEMA_STATUS['상영일정'],
          onClick: () => window.openCinemaDetail && window.openCinemaDetail(s.cinemaId),
        });
      }
    });
    // 회의록 회의 날짜 + 다음 미팅 예정일 (기존과 동일 — 타임시트는 기존처럼 주간 목록에 미포함)
    (window.minuteRecords || []).forEach(mn => {
      if (mn.date >= ws && mn.date <= we) {
        push(`meeting_minute:${mn.id}:${mn.date}`, {
          date: mn.date, time: '', label: `📝 ${mn.title}`, sub: '회의', color: MINUTE_COLOR,
          onClick: () => window.openMinuteDetailById && window.openMinuteDetailById(mn.id),
        });
      }
      if (mn.nextDate && mn.nextDate >= ws && mn.nextDate <= we) {
        push(`next_meeting:${mn.id}:${mn.nextDate}`, {
          date: mn.nextDate, time: '', label: `📝 다음 회의: ${mn.title}`, sub: '다음 회의 예정', color: MINUTE_COLOR,
          onClick: () => window.openMinuteDetailById && window.openMinuteDetailById(mn.id),
        });
      }
    });

    // 정렬: 날짜 ↑ → 시간 있는 일정 먼저 시간 ↑ → 종일 일정 뒤 (기존 방식 유지)
    items.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));

    if (!items.length) {
      listBox.appendChild(el('<div class="empty" style="padding:26px 20px">이 주에는 일정이 없어요.</div>'));
      return;
    }
    const list = el('<div class="week-list"></div>');
    items.forEach(it => {
      const isToday = it.date === today;           // 오늘이 포함된 주에서만 자연히 참이 됨
      const row = el(`<button class="week-item ${isToday ? 'today' : ''}">
        <span class="week-date">${fmtDateShort(it.date)} (${weekdayKo(it.date)})${isToday ? ' · 오늘' : ''}</span>
        <span class="cal-dot" style="background:${it.color};flex-shrink:0"></span>
        <span class="week-name">${esc(it.label)}</span>
        <span class="week-sub">${esc(it.sub)}</span>
      </button>`);
      row.addEventListener('click', it.onClick);
      list.appendChild(row);
    });
    listBox.appendChild(list);
  }

  /* ---------- 일반 이벤트 CRUD (calendar_events) ---------- */
  function openForm(existing, defaultDate) {
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
    /* '이번주 목표' 섹터: 시작일이 속한 한 주(일~토)를 통째로 선택 (기존 규칙 유지) */
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

    let saving = false;
    async function afterChange(msg) {
      closeModal();
      await reload({ skipRender: true });          // 캘린더 데이터 재조회
      if (typeof currentView !== 'undefined' && currentView === 'calendar') { drawMonth(); drawWeek(); }
      toast(msg);
    }

    const footer = [];
    if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => {
      confirmDelete(`'${e.name}' 이벤트를 삭제할까요?`, async () => {
        try {
          const { error } = await supabaseClient.from('calendar_events').delete().eq('id', existing.id);
          if (error) throw error;
          await afterChange('삭제되었습니다');
        } catch (err) { console.error('[calendar] 삭제 실패', err); toast('삭제 실패: ' + friendly(err)); }
      });
    }));
    footer.push(mkBtn('취소', 'btn-ghost', closeModal));
    footer.push(mkBtn(existing ? '저장' : '추가', 'btn-primary', async () => {
      if (saving) return;
      const fd = new FormData(form);
      const name = fd.get('name').trim();
      if (!name) return toast('이벤트명을 입력해주세요');
      let date = fd.get('date');
      let dateEnd = fd.get('dateEnd');
      if (!date) return toast('시작일을 선택해주세요');
      if (getSector() === '이번주 목표') [date, dateEnd] = weekRangeOf(date); // 저장 시에도 1주 보장
      if (dateEnd && dateEnd < date) return toast('종료일이 시작일보다 빠를 수 없어요');
      if (dateEnd === date) dateEnd = '';
      const time = hhSel.value === '' ? '' : `${hhSel.value}:${mmSel.value || '00'}`;
      const payload = {
        title: name,
        event_type: LABEL_TO_TYPE[getSector()] || 'other',
        start_date: date,
        end_date: dateEnd || null,                 // 빈 종료일 → NULL
        start_time: time || null,                  // 빈 시간 → NULL
        memo: fd.get('memo').trim() || null,       // 빈 메모 → NULL
      };
      saving = true;
      try {
        if (existing) {
          const { error } = await supabaseClient.from('calendar_events')
            .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', existing.id);
          if (error) throw error;
          await afterChange('수정되었습니다');
        } else {
          const { error } = await supabaseClient.from('calendar_events').insert(payload);
          if (error) throw error;
          await afterChange('이벤트가 추가되었습니다');
        }
      } catch (err) {
        saving = false;
        console.error('[calendar] 저장 실패', err);
        toast('저장 실패: ' + friendly(err));
      }
    }));

    openModal({ title: existing ? '이벤트 편집' : '이벤트 추가', body: form, footer });
  }

  function openDetail(e) {
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
        mkBtn('편집', 'btn-primary', () => { closeModal(); openForm(e); }),
      ],
    });
  }

  /* ---------- 공개 API + 라우터 ---------- */
  window.loadCalendarEventsData = () => reload({ skipRender: true });
  window.calendarEventRecords = events;
  if (typeof VIEWS !== 'undefined' && VIEWS && VIEWS.calendar) VIEWS.calendar.render = render;
  else console.warn('[calendar] VIEWS.calendar 를 찾지 못했습니다 — 오버라이드 건너뜀');
})();
