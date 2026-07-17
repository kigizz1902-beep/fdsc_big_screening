/* =========================================================
   아이디어·메모 (Supabase 관계형 + 댓글, 이미지 제거)
   ---------------------------------------------------------
   원본: ideas / idea_members(작성자) / idea_comments(댓글) + members
   · DB.ideas / localStorage / bigact / 이미지·Storage 를 원본으로 쓰지 않는다.
   · 이미지 첨부 기능 없음(Storage 미사용). URL 은 link_url 로 유지·카드에 링크 칩 표시.
   · app.js 헬퍼(el,$,openModal,closeModal,mkBtn,confirmDelete,toast,addTopbarAction,
     rerender,esc,nl2br,textColorOn,currentView,VIEWS,IDEA_TYPES,pillSelect,
     pillMultiSelect,downloadSheet)와 supabase.js 의 supabaseClient 재사용.
   · 기존 renderIdeas/openIdeaModal 은 남기고 VIEWS.ideas.render 만 대체.
   보안: 로그인이 없어 실제 작성자를 인증할 수 없음 — 화면에서 고른 member_id 를 표시용으로 저장할 뿐.
   ========================================================= */
(function () {
  'use strict';

  let ideas = [];        // 화면용 아이디어(작성자·댓글 포함)
  let members = [];      // 활성 팀원
  let loaded = false, loading = false, errorMsg = null;
  let reqSeq = 0;        // 오래된 응답이 최신 화면을 덮어쓰지 않게
  let ideaFilter = '전체';
  const expandedIdeaIds = new Set();  // 사용자가 직접 펼친 카드
  const collapsedIdeaIds = new Set(); // 사용자가 직접 접은 카드
  // 댓글이 있으면 기본으로 펼침. 단, 사용자가 직접 접었으면 접힌 상태 유지.
  function isExpanded(i) {
    if (collapsedIdeaIds.has(i.id)) return false;
    return (i.comments && i.comments.length > 0) || expandedIdeaIds.has(i.id);
  }

  /* ---------- 유틸 ---------- */
  function friendly(e) {
    const msg = (e && (e.message || e.error_description || e.details)) || '';
    if (/relation .* does not exist|42P01/i.test(msg)) return '아이디어 테이블이 없습니다. sql/ideas.sql 을 먼저 실행하세요.';
    return msg || '알 수 없는 오류';
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const s = String(iso);
    return `${s.slice(0, 10).replace(/-/g, '.')} ${s.slice(11, 16)}`;
  }
  function catColor(cat) { return (typeof IDEA_TYPES !== 'undefined' && IDEA_TYPES[cat]) || '#9a8f95'; }
  // URL 검증/정규화: 빈값 → {ok, value:null} / 프로토콜 없으면 https:// / http(s) 아니면 실패
  function normalizeLink(raw) {
    const u = String(raw || '').trim();
    if (!u) return { ok: true, value: null };
    const withProto = /^https?:\/\//i.test(u) ? u : 'https://' + u;
    try { new URL(withProto); } catch (e) { return { ok: false }; }
    if (!/^https?:\/\//i.test(withProto)) return { ok: false };
    return { ok: true, value: withProto };
  }
  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  /* ---------- 조회 ---------- */
  async function fetchMembers() {
    const { data, error } = await supabaseClient
      .from('members').select('id, name, role, color, display_order')
      .eq('is_active', true).order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function fetchIdeas() {
    const { data, error } = await supabaseClient
      .from('ideas')
      .select('id, category, content, link_url, legacy_id, created_at, updated_at, idea_members ( member_id, display_order, members ( id, name, color ) ), idea_comments ( id, member_id, content, created_at, updated_at, members ( id, name, color ) )')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(r => ({
      id: r.id,
      category: r.category,
      content: r.content || '',
      linkUrl: r.link_url || null,
      authors: (r.idea_members || [])
        .slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .map(im => ({ memberId: im.member_id, name: (im.members || {}).name || '(알 수 없음)', color: (im.members || {}).color || '#9a8f95' })),
      comments: (r.idea_comments || [])
        .slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
        .map(c => ({ id: c.id, memberId: c.member_id, name: (c.members || {}).name || '(알 수 없음)', color: (c.members || {}).color || '#9a8f95', content: c.content || '', createdAt: c.created_at, updatedAt: c.updated_at })),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async function reload() {
    if (!supabaseClient) return;
    const my = ++reqSeq;
    loading = true;
    try {
      const [ms, ids] = await Promise.all([fetchMembers(), fetchIdeas()]);
      if (my !== reqSeq) return;
      members = ms; ideas = ids; loaded = true; errorMsg = null;
    } catch (e) {
      if (my !== reqSeq) return;
      console.error('[ideas] 데이터 조회 실패', e);
      errorMsg = friendly(e);
    } finally {
      if (my === reqSeq) {
        loading = false;
        window.ideaRecords = ideas; // 엑셀/백업(app.js)이 참조
        if (typeof currentView !== 'undefined' && currentView === 'ideas') rerender();
      }
    }
  }

  /* ---------- 렌더 ---------- */
  function render() {
    addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', onExport));
    addTopbarAction(mkBtn('+ 아이디어', 'btn-sm btn-primary', () => openForm(null)));

    const view = $('#view');
    if (!supabaseClient) { view.appendChild(el(`<div class="empty"><span class="empty-emoji">☁️</span>클라우드가 설정되지 않았습니다.</div>`)); return; }
    if (errorMsg) {
      const box = el(`<div class="empty"><span class="empty-emoji">⚠️</span>아이디어를 불러오지 못했어요.<br><span class="hint">${esc(errorMsg)}</span><br><br></div>`);
      box.appendChild(mkBtn('다시 시도', 'btn-sm btn-primary', () => { errorMsg = null; reload(); rerender(); }));
      view.appendChild(box); return;
    }
    if (!loaded) { view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏳</span>아이디어를 불러오는 중…</div>`)); if (!loading) reload(); return; }

    // 필터 바 (전체 + IDEA_TYPES)
    const filterBar = el('<div class="filter-bar"></div>');
    ['전체', ...Object.keys(typeof IDEA_TYPES !== 'undefined' ? IDEA_TYPES : {})].forEach(t => {
      const chip = el(`<button class="chip ${ideaFilter === t ? 'active' : ''}">${esc(t)}</button>`);
      chip.addEventListener('click', () => { ideaFilter = t; rerender(); });
      filterBar.appendChild(chip);
    });
    view.appendChild(filterBar);

    const list = ideas.filter(i => ideaFilter === '전체' || i.category === ideaFilter);
    if (!list.length) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">💡</span>${ideas.length ? '해당 유형의 아이디어가 없어요.' : '아직 아이디어가 없어요.<br>첫 아이디어를 남겨보세요!'}</div>`));
      return;
    }

    const grid = el('<div class="idea-grid"></div>');
    grid.innerHTML = list.map(cardHtml).join('');
    grid.addEventListener('click', onGridClick); // 이벤트 위임(카드마다 리스너 X)
    view.appendChild(grid);
  }

  function cardHtml(i) {
    const color = catColor(i.category);
    const [head, ...rest] = String(i.content || '').split('\n');
    const bodyRest = rest.join('\n');
    const authorsHtml = i.authors.length
      ? `<div class="idea-authors" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${i.authors.map(a => `<span class="tag" style="background:${a.color};color:${textColorOn(a.color)}">${esc(a.name)}</span>`).join('')}</div>`
      : '';
    const linkHtml = i.linkUrl
      ? `<a class="idea-link" href="${esc(i.linkUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(i.linkUrl)}"
           style="display:inline-flex;align-items:center;gap:5px;max-width:100%;margin-top:8px;padding:5px 9px;border-radius:8px;background:var(--bg,#f5f2f0);color:inherit;text-decoration:none;font-size:12.5px;overflow:hidden">
           <span>🔗</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(domainOf(i.linkUrl))}</span><span style="opacity:.6">↗</span></a>`
      : '';
    const expanded = isExpanded(i);
    return `<div class="idea-card" data-id="${i.id}" style="border-top-color:${color}">
      <div class="idea-body">
        <div style="margin-bottom:8px"><span class="tag" style="background:${color};color:${textColorOn(color)}">${esc(i.category)}</span></div>
        <div class="idea-title">${esc(head)}</div>
        ${bodyRest.trim() ? `<div class="idea-content">${nl2br(bodyRest)}</div>` : ''}
        ${linkHtml}
        ${authorsHtml}
        <div class="idea-foot">
          <button class="btn btn-sm btn-icon" data-action="toggle-comments" data-id="${i.id}">💬 댓글 ${i.comments.length}</button>
          <button class="btn btn-sm btn-icon" data-action="edit-idea" data-id="${i.id}">편집</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-action="delete-idea" data-id="${i.id}">🗑</button>
        </div>
        <div class="idea-comments" data-id="${i.id}" ${expanded ? '' : 'hidden'}
             style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line,#e5ded9)">
          ${commentsHtml(i)}
        </div>
      </div>
    </div>`;
  }

  function commentsHtml(i) {
    const rows = i.comments.length
      ? i.comments.map(c => `<div class="idea-comment" data-cid="${c.id}" style="display:flex;gap:6px;align-items:flex-start;margin-bottom:7px;font-size:13px">
          <span class="tag-dot" style="background:${c.color};margin-top:5px;flex-shrink:0"></span>
          <div style="flex:1;min-width:0">
            <div><b>${esc(c.name)}</b> <span class="hint" style="font-size:11px">${fmtDateTime(c.createdAt)}${c.updatedAt && c.updatedAt !== c.createdAt ? ' (수정됨)' : ''}</span></div>
            <div style="white-space:pre-wrap;word-break:break-word">${esc(c.content)}</div>
          </div>
          <button class="btn btn-sm btn-icon" data-action="edit-comment" data-id="${i.id}" data-cid="${c.id}">수정</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-action="delete-comment" data-id="${i.id}" data-cid="${c.id}">삭제</button>
        </div>`).join('')
      : `<div class="hint" style="margin-bottom:7px">아직 댓글이 없습니다.</div>`;
    const memberOpts = members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    const inputStyle = 'width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--line,#e5ded9);border-radius:8px;font-size:13px';
    // 작성자 선택은 윗줄, 입력+등록은 아랫줄 — 카드 폭에 맞춰 잘리지 않게
    const addForm = `<div class="idea-comment-add" style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
        <select data-role="cmt-member" style="${inputStyle}">${memberOpts}</select>
        <div style="display:flex;gap:6px">
          <input data-role="cmt-input" type="text" placeholder="댓글 달기…" style="flex:1;min-width:0;${inputStyle}" />
          <button class="btn btn-sm btn-primary" data-action="add-comment" data-id="${i.id}" style="flex:0 0 auto">등록</button>
        </div>
      </div>`;
    return rows + addForm;
  }

  /* ---------- 이벤트 위임 ---------- */
  async function onGridClick(e) {
    if (e.target.closest('a.idea-link')) return; // 링크는 기본 동작(새 탭)
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const ideaId = Number(btn.dataset.id);
    const idea = ideas.find(x => x.id === ideaId);
    if (!idea) return;

    if (action === 'toggle-comments') {
      const section = btn.closest('.idea-card').querySelector('.idea-comments');
      if (isExpanded(idea)) { collapsedIdeaIds.add(ideaId); expandedIdeaIds.delete(ideaId); section.hidden = true; }
      else { expandedIdeaIds.add(ideaId); collapsedIdeaIds.delete(ideaId); section.hidden = false; }
      return;
    }
    if (action === 'edit-idea') { openForm(idea); return; }
    if (action === 'delete-idea') { onDeleteIdea(idea); return; }
    if (action === 'add-comment') {
      const section = btn.closest('.idea-comments');
      const sel = section.querySelector('[data-role=cmt-member]');
      const inp = section.querySelector('[data-role=cmt-input]');
      addComment(ideaId, Number(sel.value), inp.value, btn);
      return;
    }
    if (action === 'edit-comment') {
      const c = idea.comments.find(x => x.id === Number(btn.dataset.cid));
      if (c) openCommentEdit(idea, c);
      return;
    }
    if (action === 'delete-comment') {
      const c = idea.comments.find(x => x.id === Number(btn.dataset.cid));
      if (c) onDeleteComment(c);
      return;
    }
  }

  /* ---------- 아이디어 등록/수정 모달 ---------- */
  function openForm(existing) {
    if (!members.length) { toast('팀원을 불러오지 못했습니다. sql 실행을 확인하세요.'); return; }
    const cats = Object.entries(typeof IDEA_TYPES !== 'undefined' ? IDEA_TYPES : { 기타: '#9a8f95' });
    const initCat = existing ? existing.category : cats[0][0];
    const form = el(`
      <form id="ideaForm">
        <div class="field"><label>내용 <span class="req">*</span></label>
          <textarea name="content" placeholder="아이디어/메모 (첫 줄이 제목처럼 표시됩니다)" style="min-height:90px">${esc(existing ? existing.content : '')}</textarea></div>
        <div class="field"><label>유형 <span class="req">*</span></label>
          <div class="pill-select" id="typePick"></div></div>
        <div class="field"><label>관련 링크</label>
          <input type="text" name="link" placeholder="https://example.com" value="${esc(existing && existing.linkUrl ? existing.linkUrl : '')}" />
          <div class="hint">http:// 또는 https:// 링크. 없으면 비워두세요.</div></div>
        <div class="field"><label>작성자·참여자 <span class="req">*</span> <span class="hint" style="font-weight:400">(여러 명 선택 가능)</span></label>
          <div class="pill-select" id="authorPick"></div></div>
      </form>`);

    const getCat = pillSelect($('#typePick', form), cats, initCat);
    const initAuthors = existing ? existing.authors.map(a => a.name) : (members[0] ? [members[0].name] : []);
    const getAuthors = pillMultiSelect($('#authorPick', form), members.map(m => [m.name, m.color || '#9a8f95']), initAuthors);

    const footer = [];
    if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => onDeleteIdea(existing)));
    footer.push(mkBtn('취소', 'btn-ghost', closeModal));
    const saveBtn = mkBtn(existing ? '저장' : '추가', 'btn-primary', () => submitIdea(saveBtn, form, getCat, getAuthors, existing));
    footer.push(saveBtn);
    openModal({ title: existing ? '아이디어 편집' : '아이디어 추가', body: form, footer });
  }

  async function submitIdea(btn, form, getCat, getAuthors, existing) {
    const category = getCat();
    const content = String(form.querySelector('[name=content]').value || '').trim();
    const link = normalizeLink(form.querySelector('[name=link]').value);
    const authorNames = getAuthors();
    const authorIds = authorNames.map(n => (members.find(m => m.name === n) || {}).id).filter(Boolean);

    if (!content) return toast('내용을 입력해주세요');
    if (!category) return toast('유형을 선택해주세요');
    if (!link.ok) return toast('링크는 http:// 또는 https:// 형식이어야 합니다');
    if (!authorIds.length) return toast('작성자를 한 명 이상 선택해주세요');

    btn.disabled = true;
    try {
      let ideaId;
      if (existing) {
        const { error } = await supabaseClient.from('ideas')
          .update({ category, content, link_url: link.value, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
        ideaId = existing.id;
        // 작성자 재설정: 기존 연결 삭제 후 재삽입
        const { error: eDel } = await supabaseClient.from('idea_members').delete().eq('idea_id', ideaId);
        if (eDel) { console.error('[ideas] 작성자 초기화 실패', eDel); toast('아이디어는 수정됐지만 작성자 갱신에 실패했습니다: ' + friendly(eDel)); btn.disabled = false; return; }
      } else {
        const { data, error } = await supabaseClient.from('ideas')
          .insert({ category, content, link_url: link.value }).select('id').single();
        if (error) throw error;
        ideaId = data.id;
      }
      // 작성자 연결 삽입
      const rows = authorIds.map((mid, idx) => ({ idea_id: ideaId, member_id: mid, display_order: idx }));
      const { error: eIns } = await supabaseClient.from('idea_members').insert(rows);
      if (eIns) { console.error('[ideas] 작성자 연결 실패', eIns); toast((existing ? '아이디어 수정' : '아이디어 저장') + '은 됐지만 작성자 연결에 실패했습니다: ' + friendly(eIns)); btn.disabled = false; await reload(); return; }

      closeModal();
      toast(existing ? '수정되었습니다' : '아이디어가 추가되었습니다');
      await reload();
    } catch (e) {
      console.error('[ideas] 저장 실패', e);
      toast('저장에 실패했습니다: ' + friendly(e));
      btn.disabled = false;
    }
  }

  function onDeleteIdea(idea) {
    const head = String(idea.content || '').split('\n')[0];
    confirmDelete(`'${head}' 아이디어를 삭제할까요? (댓글도 함께 삭제됩니다)`, async () => {
      try {
        const { error } = await supabaseClient.from('ideas').delete().eq('id', idea.id); // CASCADE 로 멤버·댓글 삭제
        if (error) throw error;
        expandedIdeaIds.delete(idea.id);
        toast('삭제되었습니다');
        await reload();
      } catch (e) { console.error('[ideas] 삭제 실패', e); toast('삭제에 실패했습니다: ' + friendly(e)); }
    });
  }

  /* ---------- 댓글 ---------- */
  async function addComment(ideaId, memberId, rawContent, btn) {
    const content = String(rawContent || '').trim();
    if (!memberId) return toast('작성자를 선택해주세요');
    if (!content) return toast('댓글 내용을 입력해주세요');
    btn.disabled = true;
    try {
      const { error } = await supabaseClient.from('idea_comments').insert({ idea_id: ideaId, member_id: memberId, content });
      if (error) throw error;
      expandedIdeaIds.add(ideaId); collapsedIdeaIds.delete(ideaId); // 등록 후 펼침 유지
      toast('댓글이 등록되었습니다');
      await reload();
    } catch (e) {
      console.error('[ideas] 댓글 등록 실패', e);
      toast('댓글 등록에 실패했습니다: ' + friendly(e));
      btn.disabled = false;
    }
  }

  function openCommentEdit(idea, comment) {
    const form = el(`<form>
      <div class="field"><label>작성자</label><div class="pill-select" id="cmtMember"></div></div>
      <div class="field"><label>댓글 내용 <span class="req">*</span></label>
        <textarea name="content" style="min-height:70px">${esc(comment.content)}</textarea></div>
    </form>`);
    const getMember = pillSelect($('#cmtMember', form), members.map(m => [m.name, m.color || '#9a8f95']), comment.name);
    const saveBtn = mkBtn('저장', 'btn-primary', async () => {
      const content = String(form.querySelector('[name=content]').value || '').trim();
      const member = members.find(m => m.name === getMember());
      if (!content) return toast('댓글 내용을 입력해주세요');
      if (!member) return toast('작성자를 선택해주세요');
      saveBtn.disabled = true;
      try {
        const { error } = await supabaseClient.from('idea_comments')
          .update({ content, member_id: member.id, updated_at: new Date().toISOString() })
          .eq('id', comment.id);
        if (error) throw error;
        expandedIdeaIds.add(idea.id); collapsedIdeaIds.delete(idea.id);
        closeModal();
        toast('댓글이 수정되었습니다');
        await reload();
      } catch (e) { console.error('[ideas] 댓글 수정 실패', e); toast('수정에 실패했습니다: ' + friendly(e)); saveBtn.disabled = false; }
    });
    openModal({ title: '댓글 수정', body: form, footer: [mkBtn('취소', 'btn-ghost', closeModal), saveBtn] });
  }

  function onDeleteComment(comment) {
    confirmDelete('이 댓글을 삭제할까요?', async () => {
      try {
        const { error } = await supabaseClient.from('idea_comments').delete().eq('id', comment.id);
        if (error) throw error;
        toast('댓글이 삭제되었습니다');
        await reload();
      } catch (e) { console.error('[ideas] 댓글 삭제 실패', e); toast('삭제에 실패했습니다: ' + friendly(e)); }
    });
  }

  /* ---------- 엑셀 ---------- */
  function onExport() {
    if (!ideas.length) return toast('내보낼 데이터가 없어요');
    const rows = ideas.map(i => ({
      카테고리: i.category,
      내용: i.content,
      '관련 링크': i.linkUrl || '',
      '작성자/참여자': i.authors.map(a => a.name).join(', '),
      '댓글 수': i.comments.length,
      작성일: i.createdAt ? String(i.createdAt).slice(0, 10) : '',
      수정일: i.updatedAt ? String(i.updatedAt).slice(0, 10) : '',
    }));
    if (typeof downloadSheet === 'function') downloadSheet(rows, '아이디어메모', '아이디어');
    else toast('엑셀 모듈을 찾을 수 없어요');
  }

  /* ---------- 공개 API + 라우터 ---------- */
  window.loadIdeasData = reload;
  window.ideaRecords = ideas; // 초기 게시
  if (typeof VIEWS !== 'undefined' && VIEWS && VIEWS.ideas) VIEWS.ideas.render = render;
  else console.warn('[ideas] VIEWS.ideas 를 찾지 못했습니다 — 오버라이드 건너뜀');
})();
