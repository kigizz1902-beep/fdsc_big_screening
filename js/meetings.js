/* =========================================================
   회의록 (Supabase 관계형 테이블 버전)
   ---------------------------------------------------------
   원본: meeting_minutes / meeting_minute_members (+ members)
         외부 게스트는 meeting_minutes.guest_names TEXT[]
   · DB.minutes / localStorage / bigact / 하드코딩 MEMBERS 를 원본으로 쓰지 않음.
   · app.js 헬퍼(el,$,openModal,closeModal,mkBtn,confirmDelete,toast,addTopbarAction,
     rerender,esc,nl2br,fmtDate,weekdayKo,todayStr,textColorOn,pillMultiSelect,
     currentView,VIEWS,MINUTE_COLOR,exportMinutes)와 supabase.js 의 supabaseClient 재사용.
   · 기존 renderMinutes/openMinuteModal/downloadMinuteDoc 는 남기고 VIEWS.minutes.render 만 대체.
   보안: 로그인 없음 — 화면에서 고른 member_id 를 참석자로 저장할 뿐.
   ========================================================= */
(function () {
  'use strict';

  let minutes = [], members = [];
  let loaded = false, loading = false, errorMsg = null, reqSeq = 0;

  function friendly(e) {
    const m = (e && (e.message || e.details || e.error_description)) || '';
    if (/relation .* does not exist|42P01/i.test(m)) return '회의록 테이블이 없습니다. sql/meeting_minutes.sql 을 먼저 실행하세요.';
    return m || '알 수 없는 오류';
  }

  /* ---------- 조회 ---------- */
  async function fetchMembers() {
    const { data, error } = await supabaseClient.from('members')
      .select('id, name, color, display_order').eq('is_active', true).order('display_order', { ascending: true });
    if (error) throw error; return data || [];
  }
  async function fetchMinutes() {
    const { data, error } = await supabaseClient.from('meeting_minutes')
      .select('id, title, meeting_date, purpose, content, next_agenda, next_meeting_date, guest_names, created_at, updated_at, meeting_minute_members ( member_id, display_order, members ( id, name, color ) )')
      .order('meeting_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id, title: r.title, date: r.meeting_date,
      purpose: r.purpose, content: r.content, nextAgenda: r.next_agenda, nextDate: r.next_meeting_date,
      guests: Array.isArray(r.guest_names) ? r.guest_names : [],
      participants: (r.meeting_minute_members || []).slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .map(p => ({ memberId: p.member_id, name: (p.members || {}).name || '(알 수 없음)', color: (p.members || {}).color || '#9a8f95' })),
      createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  async function reload() {
    if (!supabaseClient) return;
    const my = ++reqSeq; loading = true;
    try {
      const [ms, mn] = await Promise.all([fetchMembers(), fetchMinutes()]);
      if (my !== reqSeq) return;
      members = ms; minutes = mn; loaded = true; errorMsg = null;
    } catch (e) {
      if (my !== reqSeq) return;
      console.error('[minutes] 조회 실패', e); errorMsg = friendly(e);
    } finally {
      if (my === reqSeq) {
        loading = false;
        window.minuteRecords = minutes; // 캘린더·엑셀(app.js) 참조
        if (typeof currentView !== 'undefined' && (currentView === 'minutes' || currentView === 'calendar')) rerender();
      }
    }
  }

  /* ---------- 렌더 ---------- */
  function render() {
    addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', () => { if (typeof exportMinutes === 'function') exportMinutes(); }));
    addTopbarAction(mkBtn('+ 회의록', 'btn-sm btn-primary', () => openForm(null)));
    const view = $('#view');
    if (!supabaseClient) { view.appendChild(el(`<div class="empty"><span class="empty-emoji">☁️</span>클라우드 미설정</div>`)); return; }
    if (errorMsg) {
      const box = el(`<div class="empty"><span class="empty-emoji">⚠️</span>회의록을 불러오지 못했어요.<br><span class="hint">${esc(errorMsg)}</span><br><br></div>`);
      box.appendChild(mkBtn('다시 시도', 'btn-sm btn-primary', () => { errorMsg = null; reload(); rerender(); }));
      view.appendChild(box); return;
    }
    if (!loaded) { view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏳</span>회의록을 불러오는 중…</div>`)); if (!loading) reload(); return; }
    if (!minutes.length) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">📝</span>아직 회의록이 없어요.<br>우측 상단 <b>+ 회의록</b>으로 첫 회의를 기록해보세요.</div>`));
      return;
    }
    const list = el('<div></div>');
    minutes.forEach(m => list.appendChild(minuteCard(m))); // 이미 meeting_date 최신순 정렬
    view.appendChild(list);
  }

  function minuteCard(m) {
    const people = [
      ...m.participants.map(p => `<span class="tag" style="background:${p.color};color:${textColorOn(p.color)}">${esc(p.name)}</span>`),
      ...m.guests.map(g => `<span class="tag tag-soft">👤 ${esc(g)}</span>`),
    ].join('');
    const preview = [m.purpose && `목적: ${m.purpose}`, m.content].filter(Boolean).join(' · ');
    const card = el(`<div class="card minute-card">
      <div class="minute-head"><div>
        <div class="minute-title">${esc(m.title)}</div>
        <div class="minute-date">🗓 ${fmtDate(m.date)} (${weekdayKo(m.date)})${m.nextDate ? ` · 다음 미팅 ${fmtDate(m.nextDate)}` : ''}</div>
      </div></div>
      <div class="minute-people">${people}</div>
      ${preview ? `<div class="minute-preview">${esc(preview)}</div>` : ''}
      <div class="minute-foot">
        <button class="btn btn-sm" data-act="doc">📄 워드 다운로드</button>
        <button class="btn btn-sm btn-icon" data-act="edit">편집</button>
        <button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button>
      </div>
    </div>`);
    card.addEventListener('click', (ev) => { if (ev.target.closest('button')) return; openDetail(m); });
    $('[data-act=doc]', card).addEventListener('click', () => downloadDoc(m));
    $('[data-act=edit]', card).addEventListener('click', () => openForm(m));
    $('[data-act=del]', card).addEventListener('click', () => onDelete(m));
    return card;
  }

  function openDetail(m) {
    const people = [...m.participants.map(p => p.name), ...m.guests.map(g => `${g}(게스트)`)].join(', ');
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
        mkBtn('📄 워드', 'btn-ghost', () => downloadDoc(m)),
        mkBtn('닫기', 'btn-ghost', closeModal),
        mkBtn('편집', 'btn-primary', () => { closeModal(); openForm(m); }),
      ],
    });
  }

  /* ---------- 등록/수정 ---------- */
  function openForm(existing) {
    if (!members.length) { toast('팀원을 불러오지 못했습니다.'); return; }
    const m = existing || { title: '', date: todayStr(), participants: [], guests: [], purpose: '', content: '', nextAgenda: '', nextDate: '' };
    let guests = [...(m.guests || [])];
    const form = el(`
      <form id="minuteForm">
        <div class="field"><label>1. 제목 <span class="req">*</span></label>
          <input type="text" name="title" placeholder="예) 7월 정기회의" value="${esc(m.title)}" required /></div>
        <div class="field"><label>날짜 <span class="req">*</span></label>
          <input type="date" name="date" value="${esc(m.date || '')}" required /></div>
        <div class="field"><label>2. 참가자 <span class="req">*</span> <span style="color:var(--muted);font-weight:400">(복수 선택)</span></label>
          <div class="pill-select" id="participantsPick"></div>
          <div class="field-row" style="margin-top:10px">
            <div class="field" style="margin:0;flex:1.6"><input type="text" id="guestInput" placeholder="게스트 이름 입력" /></div>
            <div class="field" style="margin:0"><button type="button" class="btn btn-block" id="addGuestBtn">+ 게스트 추가</button></div>
          </div>
          <div class="chips" id="guestChips"></div>
        </div>
        <div class="field"><label>3. 회의 목적</label>
          <input type="text" name="purpose" placeholder="예) 상영회 장소 확정" value="${esc(m.purpose || '')}" /></div>
        <div class="field"><label>회의 내용 <span style="color:var(--muted);font-weight:400">(프로그램, 아이디어 등)</span></label>
          <textarea name="content" placeholder="논의된 내용을 기록하세요" style="min-height:120px">${esc(m.content || '')}</textarea></div>
        <div class="field"><label>4. 다음 회의 안건</label>
          <textarea name="nextAgenda" placeholder="다음 회의에서 다룰 안건">${esc(m.nextAgenda || '')}</textarea></div>
        <div class="field"><label>다음 미팅 날짜</label>
          <input type="date" name="nextDate" value="${esc(m.nextDate || '')}" /></div>
      </form>`);

    const initNames = (m.participants || []).map(p => p.name);
    const getParticipants = pillMultiSelect($('#participantsPick', form), members.map(x => [x.name, x.color || '#9a8f95']), initNames);

    const guestChips = $('#guestChips', form), guestInput = $('#guestInput', form);
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
      guests.push(v); guestInput.value = ''; drawGuests();
    };
    $('#addGuestBtn', form).addEventListener('click', addGuest);
    guestInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } });

    const footer = [];
    if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => onDelete(existing)));
    footer.push(mkBtn('취소', 'btn-ghost', closeModal));
    const saveBtn = mkBtn(existing ? '저장' : '추가', 'btn-primary', () => submit(saveBtn, form, getParticipants, () => guests, guestInput, existing));
    footer.push(saveBtn);
    openModal({ title: existing ? '회의록 편집' : '회의록 작성', body: form, footer });
  }

  async function submit(btn, form, getParticipants, getGuests, guestInput, existing) {
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    const date = fd.get('date');
    const partNames = getParticipants();
    const memberIds = partNames.map(n => (members.find(x => x.name === n) || {}).id).filter(Boolean);
    // 입력창에 남은 게스트 반영 + 공백제거·중복제거
    let guests = getGuests().slice();
    const pending = guestInput.value.trim();
    if (pending && !guests.includes(pending)) guests.push(pending);
    guests = [...new Set(guests.map(g => String(g).trim()).filter(Boolean))];

    if (!title) return toast('제목을 입력해주세요');
    if (!date) return toast('회의 날짜를 입력해주세요');
    if (!memberIds.length && !guests.length) return toast('참가자 또는 게스트를 1명 이상 추가해주세요');

    const base = {
      title, meeting_date: date,
      purpose: String(fd.get('purpose') || '').trim() || null,
      content: String(fd.get('content') || '').trim() || null,
      next_agenda: String(fd.get('nextAgenda') || '').trim() || null,
      next_meeting_date: fd.get('nextDate') || null,
      guest_names: guests,
    };

    btn.disabled = true;
    try {
      let id;
      if (existing) {
        const { error } = await supabaseClient.from('meeting_minutes').update({ ...base, updated_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw error;
        id = existing.id;
        const { error: eDel } = await supabaseClient.from('meeting_minute_members').delete().eq('meeting_minute_id', id);
        if (eDel) { console.error('[minutes] 참가자 초기화 실패', eDel); toast('회의록은 수정됐지만 참가자 갱신 실패: ' + friendly(eDel)); btn.disabled = false; return; }
      } else {
        const { data, error } = await supabaseClient.from('meeting_minutes').insert(base).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      if (memberIds.length) {
        const rows = memberIds.map((mid, i) => ({ meeting_minute_id: id, member_id: mid, display_order: i }));
        const { error: eIns } = await supabaseClient.from('meeting_minute_members').insert(rows);
        if (eIns) { console.error('[minutes] 참가자 연결 실패', eIns); toast((existing ? '수정' : '저장') + '은 됐지만 참가자 연결 실패: ' + friendly(eIns)); btn.disabled = false; await reload(); return; }
      }
      closeModal();
      toast(existing ? '수정되었습니다' : '회의록이 추가되었습니다');
      await reload();
    } catch (e) {
      console.error('[minutes] 저장 실패', e);
      toast('저장 실패: ' + friendly(e));
      btn.disabled = false;
    }
  }

  function onDelete(m) {
    confirmDelete(`'${m.title}' 회의록을 삭제할까요?`, async () => {
      try {
        const { error } = await supabaseClient.from('meeting_minutes').delete().eq('id', m.id); // CASCADE 로 참석자 연결 삭제
        if (error) throw error;
        toast('삭제되었습니다'); await reload();
      } catch (e) { console.error('[minutes] 삭제 실패', e); toast('삭제 실패: ' + friendly(e)); }
    });
  }

  /* ---------- 워드(.doc) 다운로드 (브라우저 생성, 저장 안 함) ---------- */
  function downloadDoc(m) {
    const people = [...m.participants.map(p => p.name), ...m.guests.map(g => `${g} (게스트)`)]
      .map(p => `<li>${esc(p)}</li>`).join('');
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
    const safeTitle = String(m.title).replace(/[\\/:*?"<>|]/g, '_');
    a.href = URL.createObjectURL(blob);
    a.download = `회의록_${safeTitle}_${(m.date || '').replaceAll('-', '')}.doc`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('워드 파일을 다운로드했어요');
  }

  /* ---------- 공개 API + 라우터 ---------- */
  window.loadMinutesData = reload;
  window.openMinuteDetailById = (id) => { const m = minutes.find(x => x.id === Number(id)); if (m) openDetail(m); };
  window.minuteRecords = minutes;
  if (typeof VIEWS !== 'undefined' && VIEWS && VIEWS.minutes) VIEWS.minutes.render = render;
  else console.warn('[minutes] VIEWS.minutes 를 찾지 못했습니다 — 오버라이드 건너뜀');
})();
