/* =========================================================
   회계 (Supabase 관계형 테이블 버전)
   ---------------------------------------------------------
   원본 데이터:
     분류   → accounting_categories
     계정과목 → accounting_accounts
     거래   → accounting_entries (amount = DB 생성 컬럼)
     총 버짓 → accounting_settings (id=1)
   · DB.accounting / localStorage / bigact / 하드코딩 상수를 원본으로 쓰지 않는다.
   · app.js 헬퍼(el,$,openModal,mkBtn,confirmDelete,toast,addTopbarAction,rerender,
     fmtDate,esc,textColorOn,won,comma,todayStr,currentView,VIEWS,Chart,emptyCanvas,
     MONTHS,ACCOUNT_PRICE_HINTS,downloadSheet)와 supabase.js 의 supabaseClient 재사용.
   · 기존 renderAccounting/openAccModal 등은 남겨두고 VIEWS.accounting.render 만 대체.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 상태 (화면 원본은 Supabase, 여기는 조회 캐시) ---------- */
  let categories = [];   // {id, entry_type, name, color, display_order}
  let accounts = [];     // {id, category_id, name, display_order}
  let entries = [];       // 화면용으로 변환된 거래
  let settings = { totalBudget: 0, loaded: false };
  let loaded = false, loading = false, errorMsg = null;
  let reqSeq = 0;         // 오래된 응답이 최신 화면을 덮어쓰지 않게 하는 토큰
  const charts = { donut: null, bar: null };

  /* ---------- 유틸 ---------- */
  function friendly(e) {
    const msg = (e && (e.message || e.error_description || e.details)) || '';
    if (/relation .* does not exist|42P01/i.test(msg)) {
      return '회계 테이블이 없습니다. sql/accounting.sql 을 먼저 실행하세요.';
    }
    return msg || '알 수 없는 오류';
  }
  const typeLabel = (t) => (t === 'income' ? '수입' : '지출');
  function catsOf(type) { return categories.filter(c => c.entry_type === type).sort((a, b) => a.display_order - b.display_order); }
  function accsOf(categoryId) { return accounts.filter(a => a.category_id === categoryId).sort((a, b) => a.display_order - b.display_order); }

  /* ---------- Supabase 조회 ---------- */
  async function fetchCategories() {
    const { data, error } = await supabaseClient
      .from('accounting_categories')
      .select('id, entry_type, name, color, display_order')
      .eq('is_active', true)
      .order('entry_type', { ascending: true })
      .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function fetchAccounts() {
    const { data, error } = await supabaseClient
      .from('accounting_accounts')
      .select('id, category_id, name, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function fetchEntries() {
    const { data, error } = await supabaseClient
      .from('accounting_entries')
      .select('id, account_id, transaction_date, content, quantity, occurrence_count, unit_price, amount, legacy_id, created_at, updated_at, accounting_accounts ( id, name, category_id, accounting_categories ( id, entry_type, name, color, display_order ) )')
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(r => {
      const acc = r.accounting_accounts || {};
      const cat = acc.accounting_categories || {};
      return {
        id: r.id,
        accountId: r.account_id,
        categoryId: cat.id,
        type: cat.entry_type,                 // 'income' | 'expense'
        typeLabel: typeLabel(cat.entry_type), // '수입' | '지출'
        category: cat.name || '',
        account: acc.name || '',
        color: cat.color || '#9a8f95',
        date: r.transaction_date,
        content: r.content || '',
        quantity: Number(r.quantity || 0),
        occurrenceCount: Number(r.occurrence_count || 0),
        unitPrice: Number(r.unit_price || 0),
        amount: Number(r.amount || 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }
  async function fetchSettings() {
    const { data, error } = await supabaseClient
      .from('accounting_settings').select('total_budget').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('accounting_settings(id=1) 행이 없습니다. sql/accounting.sql 을 먼저 실행하세요.');
    return { totalBudget: Number(data.total_budget || 0), loaded: true };
  }

  async function reload() {
    if (!supabaseClient) return;
    const my = ++reqSeq;
    loading = true;
    try {
      const [cats, accs, ents, setg] = await Promise.all([fetchCategories(), fetchAccounts(), fetchEntries(), fetchSettings()]);
      if (my !== reqSeq) return; // 더 최신 요청이 진행 중이면 이 결과는 폐기
      categories = cats; accounts = accs; entries = ents; settings = setg;
      loaded = true; errorMsg = null;
    } catch (e) {
      if (my !== reqSeq) return;
      console.error('[accounting] 데이터 조회 실패', e);
      errorMsg = friendly(e);
    } finally {
      if (my === reqSeq) {
        loading = false;
        publishGlobals();
        if (typeof currentView !== 'undefined' && currentView === 'accounting') rerender();
      }
    }
  }
  // app.js(엑셀·백업)가 참조할 수 있게 최신 데이터 게시
  function publishGlobals() {
    window.accountingCategories = categories;
    window.accountingAccounts = accounts;
    window.accountingEntries = entries;
    window.accountingSettings = settings;
  }

  /* ---------- 합계/잔액/사용률 (앱 기존 공식 유지: balance=budget-expense+income) ---------- */
  function stats() {
    const income = entries.filter(e => e.type === 'income').reduce((s, e) => s + Number(e.amount || 0), 0);
    const expense = entries.filter(e => e.type === 'expense').reduce((s, e) => s + Number(e.amount || 0), 0);
    const budget = Number(settings.totalBudget || 0);
    const balance = budget - expense + income;
    const rate = budget > 0 ? Math.min(100, Math.round(expense / budget * 100)) : 0;
    return { income, expense, budget, balance, rate };
  }

  /* ---------- 화면 ---------- */
  function render() {
    addTopbarAction(mkBtn('⬇ 엑셀', 'btn-sm', onExport));
    addTopbarAction(mkBtn('버짓 설정', 'btn-sm', openBudgetForm));
    addTopbarAction(mkBtn('+ 내역', 'btn-sm btn-primary', () => openForm(null)));

    const view = $('#view');
    if (!supabaseClient) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">☁️</span>클라우드가 설정되지 않았습니다.<br>supabase.js 를 확인하세요.</div>`));
      return;
    }
    if (errorMsg) {
      const box = el(`<div class="empty"><span class="empty-emoji">⚠️</span>회계 데이터를 불러오지 못했어요.<br><span class="hint">${esc(errorMsg)}</span><br><br></div>`);
      box.appendChild(mkBtn('다시 시도', 'btn-sm btn-primary', () => { errorMsg = null; reload(); rerender(); }));
      view.appendChild(box);
      return;
    }
    if (!loaded) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">⏳</span>회계 데이터를 불러오는 중…</div>`));
      if (!loading) reload();
      return;
    }

    const { income, expense, budget, balance, rate } = stats();

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

    const chartWrap = el(`<div class="charts">
      <div class="card chart-card"><h4>분류별 지출 비중</h4><div class="chart-wrap"><canvas id="donutChart"></canvas></div></div>
      <div class="card chart-card"><h4>월별 수입/지출 추이</h4><div class="chart-wrap"><canvas id="barChart"></canvas></div></div>
    </div>`);
    view.appendChild(chartWrap);

    if (!entries.length) {
      view.appendChild(el(`<div class="empty"><span class="empty-emoji">💰</span>아직 수입/지출 내역이 없어요.<br>우측 상단 <b>+ 내역</b>으로 추가해보세요.</div>`));
    } else {
      const scroll = el('<div class="table-scroll"></div>');
      const table = el(`<table class="data">
        <thead><tr><th>날짜</th><th>유형</th><th>구분</th><th>항목</th><th>내용</th><th style="text-align:center">인원<br>/수량</th><th style="text-align:center">개월<br>/횟수</th><th style="text-align:right">단가</th><th style="text-align:right">금액</th><th></th></tr></thead>
        <tbody></tbody></table>`);
      const tb = $('tbody', table);
      entries.forEach(a => {
        const col = a.color || '#9a8f95';
        const isIn = a.type === 'income';
        const tr = el(`<tr>
          <td>${fmtDate(a.date)}</td>
          <td><span class="tag" style="background:${isIn ? 'var(--p4)' : 'var(--p3)'};color:#fff">${a.typeLabel}</span></td>
          <td><span class="tag" style="background:${col};color:${textColorOn(col)}">${esc(a.category)}</span></td>
          <td>${esc(a.account)}</td>
          <td style="color:var(--muted)">${esc(a.content || '')}</td>
          <td style="text-align:center">${comma(a.quantity ?? 1)}</td>
          <td style="text-align:center">${comma(a.occurrenceCount ?? 1)}</td>
          <td class="amt">${comma(a.unitPrice ?? 0)}</td>
          <td class="amt ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${comma(a.amount)}</td>
          <td><div class="row-actions"><button class="btn btn-sm btn-icon" data-act="edit">편집</button><button class="btn btn-sm btn-icon btn-ghost" data-act="del">🗑</button></div></td>
        </tr>`);
        $('[data-act=edit]', tr).addEventListener('click', () => openForm(a));
        $('[data-act=del]', tr).addEventListener('click', () => onDelete(a));
        tb.appendChild(tr);
      });
      scroll.appendChild(table);
      view.appendChild(scroll);
    }

    drawCharts();
  }

  /* ---------- 차트 (기존 Chart 인스턴스 destroy 후 재생성) ---------- */
  function drawCharts() {
    if (charts.donut) { charts.donut.destroy(); charts.donut = null; }
    if (charts.bar) { charts.bar.destroy(); charts.bar = null; }
    if (typeof Chart === 'undefined') return;

    // 분류별 지출 (색상 = category.color)
    const byCat = {};
    entries.filter(e => e.type === 'expense').forEach(e => {
      const k = e.category || '기타';
      if (!byCat[k]) byCat[k] = { sum: 0, color: e.color || '#9a8f95' };
      byCat[k].sum += Number(e.amount || 0);
    });
    // 분류 표시 순서 = expense 카테고리 display_order
    const orderedExpenseCats = catsOf('expense').map(c => c.name).filter(n => byCat[n] && byCat[n].sum > 0);
    const donutCtx = $('#donutChart');
    if (donutCtx) {
      if (orderedExpenseCats.length) {
        charts.donut = new Chart(donutCtx, {
          type: 'doughnut',
          data: {
            labels: orderedExpenseCats,
            datasets: [{ data: orderedExpenseCats.map(c => byCat[c].sum), backgroundColor: orderedExpenseCats.map(c => byCat[c].color), borderWidth: 2, borderColor: '#fff' }],
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
      entries.forEach(e => {
        if (!e.date) return;
        const mm = Number(e.date.split('-')[1]) - 1;
        const idx = MONTHS.findIndex(m => m.m === mm);
        if (idx < 0) return;
        if (e.type === 'income') inData[idx] += Number(e.amount || 0);
        else outData[idx] += Number(e.amount || 0);
      });
      if (entries.length) {
        charts.bar = new Chart(barCtx, {
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

  /* ---------- 등록 / 수정 모달 ---------- */
  function openForm(existing) {
    if (!categories.length || !accounts.length) { toast('분류·계정과목을 불러오지 못했습니다. sql/accounting.sql 실행을 확인하세요.'); return; }
    let type = existing ? existing.type : 'expense';
    const initCatId = existing ? existing.categoryId : null;
    const initAccId = existing ? existing.accountId : null;

    const form = el(`
      <form id="accForm">
        <div class="field"><label>유형 <span class="req">*</span></label>
          <div class="seg" id="typeSeg">
            <button type="button" data-v="income" class="${type === 'income' ? 'active' : ''}">수입</button>
            <button type="button" data-v="expense" class="${type === 'expense' ? 'active' : ''}">지출</button>
          </div></div>
        <div class="field-row">
          <div class="field"><label>구분 <span class="req">*</span></label>
            <select name="group" id="accGroup"></select></div>
          <div class="field"><label>항목 <span class="req">*</span></label>
            <select name="account" id="accAccount"></select></div>
        </div>
        <div class="acc-hint" id="accHint" hidden></div>
        <div class="field"><label>내용 <span class="req">*</span></label>
          <input type="text" name="content" placeholder="예) 활동비, 회식(빅활동 팀원+연사) 등" value="${esc(existing ? existing.content : '')}" /></div>
        <div class="field-row">
          <div class="field"><label>인원/수량 (A)</label>
            <input type="number" name="qty" inputmode="decimal" min="0" step="1" value="${existing ? existing.quantity : 1}" /></div>
          <div class="field"><label>개월/횟수 (B)</label>
            <input type="number" name="times" inputmode="decimal" min="0" step="1" value="${existing ? existing.occurrenceCount : 1}" /></div>
          <div class="field"><label>단가 (C) <span class="req">*</span></label>
            <input type="text" name="unit" inputmode="numeric" placeholder="0" value="${existing && existing.unitPrice ? comma(existing.unitPrice) : ''}" /></div>
        </div>
        <div class="amount-box">
          <label>금액 <span style="color:var(--muted);font-weight:400">(A × B × C 자동 계산)</span></label>
          <div class="amount-display" id="amountDisplay">₩0</div>
        </div>
        <div class="field"><label>날짜 <span class="req">*</span></label>
          <input type="date" name="date" value="${esc(existing ? existing.date : todayStr())}" required /></div>
      </form>`);

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
      const acc = accounts.find(a => a.id === Number(accSel.value));
      const hints = acc && ACCOUNT_PRICE_HINTS[acc.name];
      if (hints && hints.length) { hintEl.hidden = false; hintEl.innerHTML = '💡 <b>단가표</b> · ' + hints.map(esc).join(' &nbsp;/&nbsp; '); }
      else { hintEl.hidden = true; hintEl.innerHTML = ''; }
    };
    const fillAccounts = (categoryId, selectedAccId) => {
      const list = accsOf(categoryId);
      accSel.innerHTML = list.map(a => `<option value="${a.id}" ${a.id === selectedAccId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
      updateHint();
    };
    const fillGroups = (selectedCatId, selectedAccId) => {
      const list = catsOf(type);
      const chosen = list.find(c => c.id === selectedCatId) || list[0];
      groupSel.innerHTML = list.map(c => `<option value="${c.id}" ${chosen && c.id === chosen.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
      fillAccounts(chosen ? chosen.id : null, selectedAccId);
    };

    $('#typeSeg', form).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.v;
      $('#typeSeg', form).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      fillGroups();
    }));
    groupSel.addEventListener('change', () => fillAccounts(Number(groupSel.value)));
    accSel.addEventListener('change', updateHint);
    fillGroups(initCatId, initAccId);

    unitIn.addEventListener('input', () => { const n = unitIn.value.replace(/[^\d]/g, ''); unitIn.value = n ? comma(n) : ''; updateAmount(); });
    qtyIn.addEventListener('input', updateAmount);
    timesIn.addEventListener('input', updateAmount);
    updateAmount();

    const footer = [];
    if (existing) footer.push(mkBtn('삭제', 'btn-danger', () => onDelete(existing)));
    footer.push(mkBtn('취소', 'btn-ghost', closeModal));
    const saveBtn = mkBtn(existing ? '저장' : '추가', 'btn-primary', () => submit(saveBtn, form, () => ({ type, catId: Number(groupSel.value), accId: Number(accSel.value) }), existing));
    footer.push(saveBtn);

    openModal({ title: existing ? '내역 편집' : '수입/지출 등록', body: form, footer });
  }

  async function submit(btn, form, getSel, existing) {
    const fd = new FormData(form);
    const { type, catId, accId } = getSel();
    const cat = categories.find(c => c.id === catId);
    const acc = accounts.find(a => a.id === accId);
    const content = String(fd.get('content') || '').trim();
    const quantity = Number(fd.get('qty')) || 0;
    const occurrence_count = Number(fd.get('times')) || 0;
    const unit_price = Number(String(fd.get('unit') || '').replace(/[^\d]/g, '')) || 0;
    const transaction_date = fd.get('date');

    // 검증 — 관계 정합성 포함
    if (!cat || cat.entry_type !== type) return toast('분류를 확인해주세요');
    if (!acc || acc.category_id !== catId) return toast('계정과목을 확인해주세요');
    if (!content) return toast('내용을 입력해주세요');
    if (!(quantity > 0)) return toast('인원/수량은 0보다 커야 합니다');
    if (!(occurrence_count > 0)) return toast('개월/횟수는 0보다 커야 합니다');
    if (!(unit_price >= 0)) return toast('단가를 확인해주세요');
    if (!transaction_date) return toast('날짜를 입력해주세요');

    // amount 는 보내지 않음 (DB 생성 컬럼)
    const payload = { account_id: accId, transaction_date, content, quantity, occurrence_count, unit_price };

    btn.disabled = true;
    try {
      let resp;
      if (existing) {
        resp = await supabaseClient.from('accounting_entries')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        resp = await supabaseClient.from('accounting_entries').insert(payload);
      }
      if (resp.error) throw resp.error;
      closeModal();
      toast(existing ? '수정되었습니다' : '내역이 추가되었습니다');
      await reload();
    } catch (e) {
      console.error('[accounting] 저장 실패', e);
      toast('저장에 실패했습니다: ' + friendly(e));
      btn.disabled = false; // 실패 시 원상 복구
    }
  }

  function onDelete(rec) {
    confirmDelete(`'${rec.content || rec.account}' 내역을 삭제할까요?`, async () => {
      try {
        const { error } = await supabaseClient.from('accounting_entries').delete().eq('id', rec.id);
        if (error) throw error;
        toast('삭제되었습니다');
        await reload();
      } catch (e) {
        console.error('[accounting] 삭제 실패', e);
        toast('삭제에 실패했습니다: ' + friendly(e));
      }
    });
  }

  /* ---------- 총 버짓 설정 (accounting_settings.id=1) ---------- */
  function openBudgetForm() {
    if (!settings.loaded) { toast('설정을 불러오지 못했습니다. sql/accounting.sql 실행을 확인하세요.'); return; }
    const form = el(`<form><div class="field"><label>총 버짓 (원)</label>
      <input type="text" name="budget" inputmode="numeric" value="${comma(settings.totalBudget)}" />
      <div class="hint">프로젝트 전체 예산을 입력하세요.</div></div></form>`);
    const input = form.querySelector('[name=budget]');
    input.addEventListener('input', () => { const n = input.value.replace(/[^\d]/g, ''); input.value = n ? comma(n) : ''; });
    const saveBtn = mkBtn('저장', 'btn-primary', async () => {
      const total_budget = Number(input.value.replace(/[^\d]/g, '') || 0);
      if (!(total_budget >= 0)) return toast('0 이상 숫자만 입력하세요');
      saveBtn.disabled = true;
      try {
        const { error } = await supabaseClient.from('accounting_settings')
          .update({ total_budget, updated_at: new Date().toISOString() }).eq('id', 1);
        if (error) throw error;
        closeModal();
        toast('버짓이 설정되었습니다');
        await reload();
      } catch (e) {
        console.error('[accounting] 버짓 저장 실패', e);
        toast('저장에 실패했습니다: ' + friendly(e));
        saveBtn.disabled = false;
      }
    });
    openModal({ title: '총 버짓 설정', body: form, footer: [mkBtn('취소', 'btn-ghost', closeModal), saveBtn] });
  }

  /* ---------- 엑셀 내보내기 (accountingEntries 기준) ---------- */
  function onExport() {
    if (!entries.length) return toast('내보낼 데이터가 없어요');
    const rows = entries.slice()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      .map(a => ({
        날짜: a.date, 유형: a.typeLabel, 구분: a.category, 항목: a.account, 내용: a.content || '',
        '인원/수량': Number(a.quantity ?? 1), '개월/횟수': Number(a.occurrenceCount ?? 1), 단가: Number(a.unitPrice ?? 0), 금액: Number(a.amount || 0),
      }));
    const { income, expense, budget, balance } = stats();
    rows.push({}, { 날짜: '요약', 구분: '총 버짓', 금액: budget });
    rows.push({ 날짜: '', 구분: '지출 합계', 금액: expense });
    rows.push({ 날짜: '', 구분: '수입 합계', 금액: income });
    rows.push({ 날짜: '', 구분: '잔액', 금액: balance });
    if (typeof downloadSheet === 'function') downloadSheet(rows, '회계시트', '회계');
    else toast('엑셀 모듈을 찾을 수 없어요');
  }

  /* ---------- 공개 API + 라우터 연결 ---------- */
  window.loadAccountingData = reload;
  publishGlobals(); // 초기 게시 (엑셀·백업이 먼저 호출돼도 안전)

  if (typeof VIEWS !== 'undefined' && VIEWS && VIEWS.accounting) {
    VIEWS.accounting.render = render;
  } else {
    console.warn('[accounting] VIEWS.accounting 를 찾지 못했습니다 — 오버라이드 건너뜀');
  }
})();
