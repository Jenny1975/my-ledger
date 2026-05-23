/* =========================================================
   記帳本 MVP - 前端應用程式邏輯
   ========================================================= */

// ---------- 設定管理 ----------
const Settings = {
  get apiUrl() { return localStorage.getItem('ledger_api_url') || ''; },
  set apiUrl(v) { localStorage.setItem('ledger_api_url', v); },
  get claudeKey() { return localStorage.getItem('ledger_claude_key') || ''; },
  set claudeKey(v) { localStorage.setItem('ledger_claude_key', v); },
};

// ---------- 後端 API 客戶端 ----------
const API = {
  async _call(action, payload = {}) {
    if (!Settings.apiUrl) throw new Error('尚未設定 API URL');
    const body = JSON.stringify({ action, ...payload });
    const url = Settings.apiUrl + '?payload=' + encodeURIComponent(body);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },
  ping()                  { return this._call('ping'); },
  listEntries(month)      { return this._call('list', { month }); },
  addEntry(entry)         { return this._call('add', { entry }); },
  addEntries(entries)     { return this._call('addBatch', { entries }); },
  updateEntry(id, patch)  { return this._call('update', { id, patch }); },
  deleteEntry(id)         { return this._call('delete', { id }); },
};

// ---------- 分類設定 (icon + 顏色) ----------
const CATEGORY_META = {
  // 支出
  '餐飲':   { icon: '🍜', color: '#c8843c', bg: '#f5e3cc' },
  '交通':   { icon: '🚗', color: '#3a6a8a', bg: '#d8e4ee' },
  '購物':   { icon: '🛍️', color: '#a04880', bg: '#ecd6e2' },
  '娛樂':   { icon: '🎬', color: '#7a5a8a', bg: '#e2d8e8' },
  '居家':   { icon: '🏠', color: '#8a7040', bg: '#ebe0c8' },
  '醫療':   { icon: '💊', color: '#a04030', bg: '#f0d4ce' },
  '教育':   { icon: '📚', color: '#5a7a3a', bg: '#dee5d2' },
  '其他':   { icon: '📌', color: '#5a5a5a', bg: '#d8d8d8' },
  // 收入
  '薪資':     { icon: '💰', color: '#5a7a3a', bg: '#dee5d2' },
  '獎金':     { icon: '🎁', color: '#c8843c', bg: '#f5e3cc' },
  '投資':     { icon: '📈', color: '#3a6a8a', bg: '#d8e4ee' },
  '回饋':     { icon: '💳', color: '#a04880', bg: '#ecd6e2' },
  '退款':     { icon: '↩️', color: '#7a5a8a', bg: '#e2d8e8' },
  '其他收入': { icon: '💵', color: '#5a5a5a', bg: '#d8d8d8' },
};

const EXPENSE_CATEGORIES = ['餐飲','交通','購物','娛樂','居家','醫療','教育','其他'];
const INCOME_CATEGORIES = ['薪資','獎金','投資','回饋','退款','其他收入'];

function getCategoryMeta(cat) {
  return CATEGORY_META[cat] || { icon: '📌', color: '#5a5a5a', bg: '#d8d8d8' };
}

// ---------- State ----------
const State = {
  entries: [],
  viewMonth: null,        // 明細頁正在看的月份 'YYYY-MM'
  statsMonth: null,       // 統計頁正在看的月份
  subtab: 'all',          // 明細子分頁: all / expense / income
  formType: 'expense',
  parsedItems: [],        // 待確認的截圖解析結果
  chart: null,
  // 快取所有月份的資料，避免反覆呼叫 API
  cache: {},              // { 'YYYY-MM': [entries] }
};

// ---------- Utils ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function ym(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthLabel(ymStr) {
  if (!ymStr) return '—';
  const [y, m] = ymStr.split('-');
  return `${y} / ${m}`;
}

function shiftMonth(ymStr, delta) {
  const [y, m] = ymStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ym(d);
}

function fmtMoney(n) {
  const num = Math.round(Number(n) || 0);
  return num.toLocaleString('en-US');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('toast--err', isErr);
  t.classList.add('toast--show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('toast--show'), 2400);
}

// 顯示完整錯誤訊息的對話框 (不會自動消失，可以複製)
function showError(title, detail) {
  // 移除已存在的
  document.querySelector('#error-modal-backdrop')?.remove();

  const html = `
    <div class="modal-backdrop" id="error-modal-backdrop">
      <div class="modal">
        <div class="modal__title">${escapeHtml(title)}</div>
        <div class="modal__sub">錯誤詳細內容</div>
        <pre class="error-detail">${escapeHtml(detail)}</pre>
        <div class="modal__actions">
          <button class="btn btn--ghost" id="error-copy">複製錯誤訊息</button>
          <button class="btn btn--primary" id="error-close">關閉</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const backdrop = $('#error-modal-backdrop');
  requestAnimationFrame(() => backdrop.classList.add('modal-backdrop--show'));

  const close = () => {
    backdrop.classList.remove('modal-backdrop--show');
    setTimeout(() => backdrop.remove(), 250);
  };

  $('#error-close').addEventListener('click', close);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close();
  });
  $('#error-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${title}\n\n${detail}`);
      $('#error-copy').textContent = '已複製';
      setTimeout(() => { const b = $('#error-copy'); if (b) b.textContent = '複製錯誤訊息'; }, 1500);
    } catch (e) {
      $('#error-copy').textContent = '複製失敗';
    }
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// 用 日期+金額+備註/商家 當交易指紋，用於去重
function entryFingerprint(e) {
  const note = String(e.note || e.merchant || '').trim();
  const amt = Math.round(Number(e.amount) || 0);
  return `${e.date}|${amt}|${note}`;
}

// ---------- Tab 切換 ----------
function initTabs() {
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      $$('.tab').forEach(t => t.classList.toggle('tab--active', t === btn));
      $$('.panel').forEach(p => p.classList.toggle('panel--active', p.dataset.panel === target));
      if (target === 'list' || target === 'stats') refreshCurrentView();
    });
  });
}

// ---------- 新增表單 ----------
function initForm() {
  $('#date').value = today();

  // 收入/支出切換
  $$('.type-toggle__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      State.formType = type;
      $$('.type-toggle__btn').forEach(b => b.classList.toggle('type-toggle__btn--active', b === btn));
      rebuildCategoryOptions();
    });
  });

  // 表單提交
  $('#entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const entry = {
      id: uid(),
      date: $('#date').value,
      type: State.formType,
      amount: Number($('#amount').value),
      category: $('#category').value,
      account: $('#account').value,
      note: $('#note').value.trim(),
      createdAt: new Date().toISOString(),
    };

    if (!entry.amount || entry.amount <= 0) {
      toast('請輸入金額', true); return;
    }

    try {
      await API.addEntry(entry);
      toast('已記錄');
      $('#amount').value = '';
      $('#note').value = '';
      // 清除快取觸發重新載入
      delete State.cache[entry.date.slice(0, 7)];
      refreshCurrentView();
    } catch (err) {
      showError('記錄失敗', String(err.message || err));
    }
  });

  rebuildCategoryOptions();
}

function rebuildCategoryOptions() {
  const sel = $('#category');
  const cats = State.formType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  sel.innerHTML = cats.map(c => {
    const m = getCategoryMeta(c);
    return `<option value="${c}">${m.icon} ${c}</option>`;
  }).join('');
}

// ---------- 月份切換 ----------
function initMonthNav() {
  $('#month-prev').addEventListener('click', () => changeMonth('list', -1));
  $('#month-next').addEventListener('click', () => changeMonth('list', 1));
  $('#stats-month-prev').addEventListener('click', () => changeMonth('stats', -1));
  $('#stats-month-next').addEventListener('click', () => changeMonth('stats', 1));
}

function changeMonth(which, delta) {
  if (which === 'list') {
    State.viewMonth = shiftMonth(State.viewMonth, delta);
    refreshList();
  } else {
    State.statsMonth = shiftMonth(State.statsMonth, delta);
    refreshStats();
  }
}

function updateMonthLabels() {
  $('#month-label').textContent = monthLabel(State.viewMonth);
  $('#stats-month-label').textContent = monthLabel(State.statsMonth);
  // 未來月份按鈕禁用
  const cur = ym();
  $('#month-next').disabled = (State.viewMonth >= cur);
  $('#stats-month-next').disabled = (State.statsMonth >= cur);
}

// ---------- 子分頁 ----------
function initSubtabs() {
  $$('.subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      State.subtab = btn.dataset.subtab;
      $$('.subtab').forEach(b => b.classList.toggle('subtab--active', b === btn));
      renderEntries();
    });
  });
}

// ---------- 載入資料 ----------
async function loadMonth(month, force = false) {
  if (!Settings.apiUrl) return [];
  if (!force && State.cache[month]) return State.cache[month];
  try {
    const data = await API.listEntries(month);
    State.cache[month] = data.entries || [];
    return State.cache[month];
  } catch (err) {
    console.error('Load failed:', err);
    return [];
  }
}

// 刷新當前看到的分頁
async function refreshCurrentView() {
  const activePanel = document.querySelector('.panel--active')?.dataset.panel;
  if (activePanel === 'list') await refreshList();
  else if (activePanel === 'stats') await refreshStats();
}

async function refreshList() {
  if (!Settings.apiUrl) return;
  State.entries = await loadMonth(State.viewMonth);
  renderEntries();
  renderSummary();
  updateMonthLabels();
}

async function refreshStats() {
  if (!Settings.apiUrl) return;
  const entries = await loadMonth(State.statsMonth);
  renderStats(entries);
  updateMonthLabels();
}

// ---------- 渲染明細 ----------
function renderEntries() {
  const list = $('#entries-list');
  let filtered = State.entries;
  if (State.subtab === 'expense') filtered = filtered.filter(e => e.type === 'expense');
  else if (State.subtab === 'income') filtered = filtered.filter(e => e.type === 'income');

  $('#list-count').textContent = filtered.length;

  if (!filtered.length) {
    const msg = State.subtab === 'income' ? '本月沒有收入記錄'
              : State.subtab === 'expense' ? '本月沒有支出記錄'
              : '本月還沒有記錄';
    list.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
    return;
  }

  const sorted = [...filtered].sort((a, b) =>
    (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const monthShort = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  list.innerHTML = sorted.map(e => {
    const parts = String(e.date).split('-');
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    const sign = e.type === 'income' ? '+' : '−';
    const meta = getCategoryMeta(e.category);
    return `
      <div class="entry" data-id="${e.id}">
        <div class="entry__date">
          <span class="entry__date-day">${d}</span>
          <span class="entry__date-mon">${monthShort[m - 1]}</span>
        </div>
        <div class="entry__detail">
          <div class="entry__category">
            <span style="margin-right:4px">${meta.icon}</span>${escapeHtml(e.category)}<span class="entry__meta">${escapeHtml(e.account || '')}</span>
          </div>
          <div class="entry__note">${escapeHtml(e.note || '—')}</div>
        </div>
        <div class="entry__amount entry__amount--${e.type}">${sign}${fmtMoney(e.amount)}</div>
      </div>`;
  }).join('');

  $$('.entry').forEach(el => {
    el.addEventListener('click', () => editEntry(el.dataset.id));
  });
}

function renderSummary() {
  let income = 0, expense = 0;
  for (const e of State.entries) {
    if (e.type === 'income') income += Number(e.amount) || 0;
    else expense += Number(e.amount) || 0;
  }
  $('#sum-income').textContent = fmtMoney(income);
  $('#sum-expense').textContent = fmtMoney(expense);
  $('#sum-balance').textContent = fmtMoney(income - expense);
}

// ---------- 編輯/刪除 (Modal 版) ----------
function editEntry(id) {
  const e = State.entries.find(x => x.id === id);
  if (!e) return;

  const cats = e.type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const catOptions = cats.map(c => {
    const m = getCategoryMeta(c);
    return `<option value="${c}" ${c === e.category ? 'selected' : ''}>${m.icon} ${c}</option>`;
  }).join('');

  const modalHtml = `
    <div class="modal-backdrop" id="edit-modal-backdrop">
      <div class="modal">
        <div class="modal__title">編輯交易</div>
        <div class="modal__sub">${e.type === 'expense' ? '支出' : '收入'} · ${escapeHtml(e.account || '')}</div>

        <label class="field">
          <span class="field__label">日期</span>
          <input type="date" id="edit-date" value="${e.date}">
        </label>

        <label class="field">
          <span class="field__label">金額</span>
          <input type="number" id="edit-amount" value="${e.amount}" step="0.01">
        </label>

        <label class="field">
          <span class="field__label">分類</span>
          <select id="edit-category">${catOptions}</select>
        </label>

        <label class="field">
          <span class="field__label">商家 / 備註</span>
          <input type="text" id="edit-note" value="${escapeHtml(e.note || '')}">
        </label>

        <div class="modal__actions">
          <button class="btn btn--ghost" id="edit-cancel">取消</button>
          <button class="btn btn--danger" id="edit-delete">刪除</button>
          <button class="btn btn--primary" id="edit-save">儲存</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const backdrop = $('#edit-modal-backdrop');
  // 觸發過場動畫
  requestAnimationFrame(() => backdrop.classList.add('modal-backdrop--show'));

  const close = () => {
    backdrop.classList.remove('modal-backdrop--show');
    setTimeout(() => backdrop.remove(), 250);
  };

  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) close();
  });
  $('#edit-cancel').addEventListener('click', close);

  $('#edit-delete').addEventListener('click', async () => {
    if (!confirm('確定刪除這筆交易？')) return;
    try {
      await API.deleteEntry(id);
      delete State.cache[State.viewMonth];
      toast('已刪除');
      close();
      refreshCurrentView();
    } catch (err) {
      showError('刪除失敗', String(err.message || err));
    }
  });

  $('#edit-save').addEventListener('click', async () => {
    const patch = {
      date: $('#edit-date').value,
      amount: Number($('#edit-amount').value),
      category: $('#edit-category').value,
      note: $('#edit-note').value.trim(),
    };
    if (!patch.amount || patch.amount <= 0) {
      toast('金額不正確', true); return;
    }
    try {
      await API.updateEntry(id, patch);
      delete State.cache[e.date.slice(0, 7)];
      delete State.cache[patch.date.slice(0, 7)];
      toast('已更新');
      close();
      refreshCurrentView();
    } catch (err) {
      showError('更新失敗', String(err.message || err));
    }
  });
}

// ---------- 統計圖表 ----------
function renderStats(entries) {
  const expenses = entries.filter(e => e.type === 'expense');
  const byCategory = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  }
  const cats = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]);
  const vals = cats.map(c => byCategory[c]);
  const total = vals.reduce((s, v) => s + v, 0);

  const colors = cats.map(c => getCategoryMeta(c).color);

  const ctx = $('#category-chart').getContext('2d');
  if (State.chart) State.chart.destroy();
  if (!cats.length) {
    $('#category-breakdown').innerHTML = '<div class="empty-state"><p>這個月還沒有支出記錄</p></div>';
    State.chart = null;
    return;
  }
  State.chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats,
      datasets: [{
        data: vals,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#faf5ea',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { family: 'Noto Sans TC', size: 12 },
            color: '#2a2520',
            padding: 12,
            boxWidth: 12,
          }
        },
        tooltip: {
          callbacks: {
            label: (c) => `${c.label}: NT$${fmtMoney(c.parsed)} (${((c.parsed/total)*100).toFixed(1)}%)`
          }
        }
      }
    }
  });

  $('#category-breakdown').innerHTML = cats.map((c, i) => {
    const v = byCategory[c];
    const pct = ((v / total) * 100).toFixed(1);
    const color = colors[i];
    const meta = getCategoryMeta(c);
    return `
      <div class="breakdown-item">
        <span class="breakdown-item__swatch" style="background:${color}"></span>
        <div>
          <div class="breakdown-item__name">${meta.icon} ${escapeHtml(c)} <span style="color:#8a7f6e;font-size:12px;">${pct}%</span></div>
          <div class="breakdown-item__bar"><div class="breakdown-item__fill" style="width:${pct}%;background:${color}"></div></div>
        </div>
        <span class="breakdown-item__amount">${fmtMoney(v)}</span>
      </div>`;
  }).join('');
}

// ---------- 設定頁 ----------
function initSettings() {
  $('#api-url').value = Settings.apiUrl;
  $('#claude-key').value = Settings.claudeKey;

  $('#save-settings').addEventListener('click', () => {
    Settings.apiUrl = $('#api-url').value.trim();
    Settings.claudeKey = $('#claude-key').value.trim();
    setStatus('已儲存', false);
    updateSetupBanner();
    State.cache = {}; // 清快取
    refreshCurrentView();
  });

  $('#test-connection').addEventListener('click', async () => {
    setStatus('測試中...', false);
    try {
      const r = await API.ping();
      setStatus(`連線成功 · ${r.sheet || ''}`, false);
    } catch (e) {
      setStatus('連線失敗', true);
      showError('連線失敗', String(e.message || e));
    }
  });

  $('#setup-banner').addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.toggle('tab--active', t.dataset.tab === 'settings'));
    $$('.panel').forEach(p => p.classList.toggle('panel--active', p.dataset.panel === 'settings'));
  });
}

function setStatus(msg, isErr) {
  const s = $('#settings-status');
  s.textContent = msg;
  s.classList.toggle('settings-status--ok', !isErr);
  s.classList.toggle('settings-status--err', isErr);
}

function updateSetupBanner() {
  $('#setup-banner').classList.toggle('hidden', !!Settings.apiUrl);
}

// ---------- 截圖匯入 ----------
function initImport() {
  const zone = $('#upload-zone');
  const input = $('#file-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('upload-zone--dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('upload-zone--dragging'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('upload-zone--dragging');
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => handleFiles(input.files));

  $('#review-cancel').addEventListener('click', () => {
    $('#review-area').classList.add('hidden');
    State.parsedItems = [];
  });

  $('#review-confirm').addEventListener('click', confirmImport);
}

async function handleFiles(fileList) {
  if (!Settings.claudeKey) {
    toast('請先在「設定」填入 Gemini API Key', true);
    return;
  }
  if (!Settings.apiUrl) {
    toast('請先在「設定」填入 API URL', true);
    return;
  }
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;

  const status = $('#parsing-status');
  status.classList.remove('hidden');
  status.textContent = `正在解析 ${files.length} 張圖片，請稍候…`;

  try {
    const allItems = [];
    for (let i = 0; i < files.length; i++) {
      status.textContent = `解析第 ${i + 1} / ${files.length} 張…`;
      // 從第二張開始，先等 4 秒避免打到 Gemini 免費版每分鐘 15 次的限制
      if (i > 0) await new Promise(r => setTimeout(r, 4000));
      const items = await parseImage(files[i]);
      allItems.push(...items);
    }
    status.classList.add('hidden');
    if (!allItems.length) {
      toast('沒有辨識出交易', true);
      return;
    }

    // 自動去重：先載入所有涉及月份的既有資料
    status.classList.remove('hidden');
    status.textContent = '比對是否已存在...';
    const monthsNeeded = new Set();
    allItems.forEach(it => {
      if (it.date) monthsNeeded.add(String(it.date).slice(0, 7));
    });
    const existingFingerprints = new Set();
    for (const month of monthsNeeded) {
      const entries = await loadMonth(month, true);
      entries.forEach(e => existingFingerprints.add(entryFingerprint(e)));
    }
    status.classList.add('hidden');

    // 標記每筆是否為重複
    allItems.forEach(it => {
      const fp = entryFingerprint(it);
      it._isDuplicate = existingFingerprints.has(fp);
      // 預設 type：如果 AI 沒給就猜 expense
      if (!it.type) {
        // 金額為負或 AI 標示為 income 才當收入
        it.type = it.is_income ? 'income' : 'expense';
      }
    });

    State.parsedItems = allItems;
    renderReview();
  } catch (err) {
    status.classList.add('hidden');
    showError('截圖解析失敗', String(err.message || err));
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function parseImage(file) {
  const b64 = await fileToBase64(file);
  const prompt = `你會看到一張銀行/信用卡網銀截圖。請仔細抽出所有交易，回傳 JSON 陣列，不要加任何說明文字、不要包在 markdown code block 中，直接回 JSON。

格式：
[
  {
    "date": "YYYY-MM-DD",
    "merchant": "商家名稱或交易描述",
    "amount": 數字（正數，不含貨幣符號、不含千分位）,
    "type": "expense" 或 "income",
    "category": "從下方對應類型的清單裡挑一個"
  }
]

判斷 type 的方法：
- 一般刷卡消費 → expense
- 信用卡回饋金、現金回饋、紅利點數兌換現金 → income, category 用「回饋」
- 退款、退刷 → income, category 用「退款」
- 薪資、利息、股利 → income

支出分類選一個：餐飲、交通、購物、娛樂、居家、醫療、教育、其他
收入分類選一個：薪資、獎金、投資、回饋、退款、其他收入

注意：
- 日期格式必須是 YYYY-MM-DD，如果只有月日沒有年份，用今年 ${new Date().getFullYear()}
- 金額一律為正數
- 如果完全看不到日期就用 "${today()}"
- 如果沒有任何交易回傳空陣列 []`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${Settings.claudeKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: file.type, data: b64 } },
            { text: prompt },
          ]
        }],
        generationConfig: { temperature: 0.1 },
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('Gemini 沒有回傳內容');
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let items;
  try { items = JSON.parse(cleaned); } catch (e) {
    throw new Error('AI 回傳格式錯誤');
  }
  if (!Array.isArray(items)) throw new Error('AI 回傳非陣列');
  return items;
}

function renderReview() {
  const area = $('#review-area');
  area.classList.remove('hidden');

  // 排序：未重複的在前，重複的在後
  State.parsedItems.sort((a, b) => (a._isDuplicate ? 1 : 0) - (b._isDuplicate ? 1 : 0));

  const dupCount = State.parsedItems.filter(it => it._isDuplicate).length;
  const newCount = State.parsedItems.length - dupCount;

  let summaryHtml = '';
  if (dupCount > 0) {
    summaryHtml = `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">辨識出 ${State.parsedItems.length} 筆，其中 <strong style="color:var(--ink)">${newCount} 筆是新交易</strong>，${dupCount} 筆已經存在（預設不勾選）。</p>`;
  } else {
    summaryHtml = `<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">辨識出 ${State.parsedItems.length} 筆新交易。</p>`;
  }

  const itemsHtml = State.parsedItems.map((it, i) => {
    const cat = it.category || (it.type === 'income' ? '其他收入' : '其他');
    const meta = getCategoryMeta(cat);
    const cats = it.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const catOptions = cats.map(c => {
      const m = getCategoryMeta(c);
      return `<option value="${c}" ${c === cat ? 'selected' : ''}>${m.icon} ${c}</option>`;
    }).join('');

    const checked = !it._isDuplicate ? 'checked' : '';
    const dupClass = it._isDuplicate ? 'review-item--duplicate' : '';
    const dupTag = it._isDuplicate ? '<span class="review-item__dup-tag">已存在</span>' : '';
    const typeBadge = it.type === 'income'
      ? '<span class="review-item__type-badge review-item__type-badge--income">收</span>'
      : '<span class="review-item__type-badge">支</span>';

    return `
      <div class="review-item ${dupClass}" style="--cat-color:${meta.color};--cat-bg:${meta.bg};">
        <input type="checkbox" class="review-item__check" data-i="${i}" ${checked}>
        <div class="review-item__icon">${meta.icon}</div>
        <div class="review-item__fields">
          <div class="review-item__type-row">
            <button type="button" data-i="${i}" data-type="expense" class="${it.type !== 'income' ? 'active' : ''}">支出</button>
            <button type="button" data-i="${i}" data-type="income" class="${it.type === 'income' ? 'active' : ''}">收入</button>
            ${typeBadge} ${dupTag}
          </div>
          <input type="date" data-i="${i}" data-field="date" value="${it.date || today()}">
          <input type="text" data-i="${i}" data-field="merchant" value="${escapeHtml(it.merchant || '')}" placeholder="商家">
          <input type="number" data-i="${i}" data-field="amount" value="${it.amount || 0}" step="0.01">
          <select data-i="${i}" data-field="category" style="grid-column:1/-1;">${catOptions}</select>
        </div>
      </div>`;
  }).join('');

  $('#review-list').innerHTML = summaryHtml + itemsHtml;

  // 監聽欄位修改
  $('#review-list').addEventListener('input', (e) => {
    const i = e.target.dataset.i;
    const field = e.target.dataset.field;
    if (i !== undefined && field) {
      State.parsedItems[i][field] = e.target.value;
    }
  });

  // 監聽 type 切換
  $('#review-list').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && e.target.dataset.type) {
      const i = parseInt(e.target.dataset.i, 10);
      const newType = e.target.dataset.type;
      State.parsedItems[i].type = newType;
      // 預設分類
      if (newType === 'income' && !INCOME_CATEGORIES.includes(State.parsedItems[i].category)) {
        State.parsedItems[i].category = '回饋';
      } else if (newType === 'expense' && !EXPENSE_CATEGORIES.includes(State.parsedItems[i].category)) {
        State.parsedItems[i].category = '其他';
      }
      renderReview(); // 重繪這個項目
    }
  });
}

async function confirmImport() {
  const checks = $$('#review-list input[type=checkbox]');
  const toImport = [];
  checks.forEach((cb, i) => {
    if (cb.checked) {
      const it = State.parsedItems[i];
      toImport.push({
        id: uid(),
        date: it.date,
        type: it.type || 'expense',
        amount: Number(it.amount),
        category: it.category || (it.type === 'income' ? '其他收入' : '其他'),
        account: '信用卡',
        note: it.merchant,
        createdAt: new Date().toISOString(),
      });
    }
  });
  if (!toImport.length) {
    toast('沒有勾選任何項目', true);
    return;
  }
  try {
    await API.addEntries(toImport);
    toast(`已匯入 ${toImport.length} 筆`);
    $('#review-area').classList.add('hidden');
    State.parsedItems = [];
    // 清除所有涉及月份的快取
    toImport.forEach(e => delete State.cache[e.date.slice(0, 7)]);
    refreshCurrentView();
  } catch (err) {
    showError('匯入失敗', String(err.message || err));
  }
}

// ---------- 啟動 ----------
function init() {
  // 初始月份
  State.viewMonth = ym();
  State.statsMonth = ym();

  initTabs();
  initForm();
  initMonthNav();
  initSubtabs();
  initSettings();
  initImport();
  updateSetupBanner();

  const months = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
  const d = new Date();
  $('#current-month-label').textContent = `${d.getFullYear()} 年 ${months[d.getMonth()]}月`;

  refreshList();
}

document.addEventListener('DOMContentLoaded', init);
