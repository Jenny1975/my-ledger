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
    // Apps Script GET 不會有 CORS preflight 問題
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

// ---------- State ----------
const State = {
  entries: [],
  currentMonth: null,
  formType: 'expense',
  parsedItems: [], // 待確認的截圖解析結果
  chart: null,
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

// ---------- Tab 切換 ----------
function initTabs() {
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      $$('.tab').forEach(t => t.classList.toggle('tab--active', t === btn));
      $$('.panel').forEach(p => p.classList.toggle('panel--active', p.dataset.panel === target));
      if (target === 'list' || target === 'stats') refreshEntries();
    });
  });
}

// ---------- 新增表單 ----------
function initForm() {
  // 預填日期
  $('#date').value = today();

  // 收入/支出切換
  $$('.type-toggle__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      State.formType = type;
      $$('.type-toggle__btn').forEach(b => b.classList.toggle('type-toggle__btn--active', b === btn));
      // 切換分類選項
      $('#expense-categories').hidden = (type !== 'expense');
      $('#income-categories').hidden = (type !== 'income');
      const sel = $('#category');
      sel.value = type === 'expense' ? '餐飲' : '薪資';
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
      // 重置部分欄位
      $('#amount').value = '';
      $('#note').value = '';
      // 如果在明細頁開著，重新整理
      refreshEntries();
    } catch (err) {
      toast('記錄失敗：' + err.message, true);
    }
  });
}

// ---------- 載入並渲染明細 ----------
async function refreshEntries() {
  if (!Settings.apiUrl) return;
  try {
    const month = ym();
    State.currentMonth = month;
    const data = await API.listEntries(month);
    State.entries = data.entries || [];
    renderEntries();
    renderSummary();
    renderStats();
  } catch (err) {
    console.error(err);
  }
}

function renderEntries() {
  const list = $('#entries-list');
  if (!State.entries.length) {
    list.innerHTML = '<div class="empty-state"><p>本月還沒有記錄</p></div>';
    $('#list-count').textContent = '0';
    return;
  }
  // 日期反向排序
  const sorted = [...State.entries].sort((a, b) =>
    (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const monthShort = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  list.innerHTML = sorted.map(e => {
    const [y, m, d] = e.date.split('-');
    const sign = e.type === 'income' ? '+' : '−';
    return `
      <div class="entry" data-id="${e.id}">
        <div class="entry__date">
          <span class="entry__date-day">${parseInt(d, 10)}</span>
          <span class="entry__date-mon">${monthShort[parseInt(m, 10) - 1]}</span>
        </div>
        <div class="entry__detail">
          <div class="entry__category">${escapeHtml(e.category)}<span class="entry__meta">${escapeHtml(e.account || '')}</span></div>
          <div class="entry__note">${escapeHtml(e.note || '—')}</div>
        </div>
        <div class="entry__amount entry__amount--${e.type}">${sign}${fmtMoney(e.amount)}</div>
      </div>`;
  }).join('');

  $('#list-count').textContent = State.entries.length;

  // 點擊編輯
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ---------- 編輯/刪除 ----------
async function editEntry(id) {
  const e = State.entries.find(x => x.id === id);
  if (!e) return;

  const action = prompt(
    `編輯交易：\n${e.date}  ${e.category}  ${fmtMoney(e.amount)}\n${e.note || ''}\n\n輸入：\n  1 = 刪除\n  2 = 修改金額\n  3 = 修改備註\n  取消請按 Cancel`,
    ''
  );
  if (!action) return;

  try {
    if (action === '1') {
      if (!confirm('確定刪除？')) return;
      await API.deleteEntry(id);
      toast('已刪除');
    } else if (action === '2') {
      const n = prompt('新金額', String(e.amount));
      if (!n) return;
      await API.updateEntry(id, { amount: Number(n) });
      toast('已更新');
    } else if (action === '3') {
      const n = prompt('新備註', e.note || '');
      if (n === null) return;
      await API.updateEntry(id, { note: n });
      toast('已更新');
    } else return;
    await refreshEntries();
  } catch (err) {
    toast('操作失敗：' + err.message, true);
  }
}

// ---------- 統計圖表 ----------
function renderStats() {
  const expenses = State.entries.filter(e => e.type === 'expense');
  const byCategory = {};
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
  }
  const cats = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]);
  const vals = cats.map(c => byCategory[c]);
  const total = vals.reduce((s, v) => s + v, 0);

  // 復古色票
  const palette = ['#c8843c', '#a04030', '#5a7a3a', '#3a6a8a', '#7a5a8a', '#8a7040', '#5a5a5a', '#a06848'];

  // 圖表
  const ctx = $('#category-chart').getContext('2d');
  if (State.chart) State.chart.destroy();
  if (!cats.length) {
    $('#category-breakdown').innerHTML = '<div class="empty-state"><p>本月還沒有支出記錄</p></div>';
    return;
  }
  State.chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats,
      datasets: [{
        data: vals,
        backgroundColor: cats.map((_, i) => palette[i % palette.length]),
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

  // breakdown
  $('#category-breakdown').innerHTML = cats.map((c, i) => {
    const v = byCategory[c];
    const pct = ((v / total) * 100).toFixed(1);
    return `
      <div class="breakdown-item">
        <span class="breakdown-item__swatch" style="background:${palette[i % palette.length]}"></span>
        <div>
          <div class="breakdown-item__name">${escapeHtml(c)} <span style="color:#8a7f6e;font-size:12px;">${pct}%</span></div>
          <div class="breakdown-item__bar"><div class="breakdown-item__fill" style="width:${pct}%;background:${palette[i % palette.length]}"></div></div>
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
    refreshEntries();
  });

  $('#test-connection').addEventListener('click', async () => {
    setStatus('測試中...', false);
    try {
      const r = await API.ping();
      setStatus(`連線成功 · ${r.sheet || ''}`, false);
    } catch (e) {
      setStatus('連線失敗：' + e.message, true);
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
    toast('請先在「設定」填入 Claude API Key', true);
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
      const items = await parseImage(files[i]);
      allItems.push(...items);
    }
    status.classList.add('hidden');
    if (!allItems.length) {
      toast('沒有辨識出交易', true);
      return;
    }
    State.parsedItems = allItems;
    renderReview();
  } catch (err) {
    status.classList.add('hidden');
    toast('解析失敗：' + err.message, true);
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
    "merchant": "商家名稱",
    "amount": 數字（不含貨幣符號、不含千分位）,
    "category": "猜測的分類，從這些選一個：餐飲、交通、購物、娛樂、居家、醫療、教育、其他",
    "is_foreign": true/false
  }
]

注意：
- 日期格式必須是 YYYY-MM-DD，如果只有月日沒有年份，用今年 ${new Date().getFullYear()}
- 金額一律為正數
- 如果完全看不到日期就用 "${today()}"
- 如果沒有任何交易回傳空陣列 []`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${Settings.claudeKey}`,
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
  const categories = ['餐飲', '交通', '購物', '娛樂', '居家', '醫療', '教育', '其他'];
  $('#review-list').innerHTML = State.parsedItems.map((it, i) => `
    <div class="review-item">
      <input type="checkbox" class="review-item__check" data-i="${i}" checked>
      <div class="review-item__fields">
        <input type="date" data-i="${i}" data-field="date" value="${it.date || today()}">
        <input type="text" data-i="${i}" data-field="merchant" value="${escapeHtml(it.merchant || '')}" placeholder="商家">
        <input type="number" data-i="${i}" data-field="amount" value="${it.amount || 0}" step="0.01">
        <select data-i="${i}" data-field="category">
          ${categories.map(c => `<option ${c === it.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');

  // 監聽欄位修改
  $('#review-list').addEventListener('input', (e) => {
    const i = e.target.dataset.i;
    const field = e.target.dataset.field;
    if (i !== undefined && field) {
      State.parsedItems[i][field] = e.target.value;
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
        type: 'expense',
        amount: Number(it.amount),
        category: it.category,
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
    refreshEntries();
  } catch (err) {
    toast('匯入失敗：' + err.message, true);
  }
}

// ---------- 啟動 ----------
function init() {
  initTabs();
  initForm();
  initSettings();
  initImport();
  updateSetupBanner();
  // 月份顯示
  const months = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
  const d = new Date();
  $('#current-month-label').textContent = `${d.getFullYear()} 年 ${months[d.getMonth()]}月`;
  // 載入資料
  refreshEntries();
}

document.addEventListener('DOMContentLoaded', init);
