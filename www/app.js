// app.js —— 前端逻辑（dev-server 预览）
// 通过 dev-server 的 API 交互。
const $ = (id) => document.getElementById(id);
let currentProposal = null;
let cachedIndex = null;
let currentEdit = null; // { path, rel, before }

// Tab 切换
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
    // git Tab 打开时自动加载状态
    if (btn.dataset.tab === 'git') $('git-status').click();
  });
});

async function api(path, body) {
  const res = await fetch(path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ===== 今日速记 =====
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
$('quick-date').value = todayStr(); // 默认今天

$('quick-preview').addEventListener('click', async () => {
  const text = $('quick-text').value.trim();
  if (!text) return alert('请输入内容');
  try {
    const { proposal } = await api('/api/quick-add', { text, date: $('quick-date').value || undefined });
    if (!proposal) { $('quick-files').innerHTML = '<span class="muted">未生成提案（无内容或出错）</span>'; return; }
    currentProposal = proposal;
    renderProposal(proposal);
    $('quick-apply').disabled = false;
    $('quick-result').classList.remove('hidden');
  } catch (e) {
    alert('生成链接失败：' + e.message);
  }
});

$('quick-apply').addEventListener('click', async () => {
  if (!currentProposal) return;
  try {
    const { applied } = await api('/api/apply', { proposal: currentProposal });
    alert(`已落盘 ${applied} 个文件`);
    currentProposal = null;
    $('quick-result').classList.add('hidden');
    $('quick-apply').disabled = true;
    $('quick-text').value = '';
    loadIndex();
  } catch (e) {
    alert('落盘失败：' + e.message);
  }
});

function renderProposal(p) {
  // 实体命中
  $('quick-links').innerHTML = (p.generatedLinks || []).map((g) =>
    `<div><span class="tag">段</span> ${escapeHtml(g.para)} → ${(g.names || []).map((n) => `<span class="tag">${n}</span>`).join(' ') || '<span class="muted">无命中</span>'}</div>`
  ).join('');

  // 候选新实体
  const uniq = [...new Map((p.newCandidates || []).map((c) => [c.name, c])).values()];
  $('quick-candidates').innerHTML = uniq.length
    ? uniq.map((c) => `<span class="tag">${escapeHtml(c.name)}</span>`).join(' ')
    : '<span class="muted">无 —— 新实体由你在"人物"页手动创建</span>';

  // 回忆归类
  $('quick-recollections').innerHTML = (p.recollections && p.recollections.length)
    ? p.recollections.map((r) => `<span class="tag rec-stage">${escapeHtml(r.stage)}</span> <code class="muted">^${escapeHtml(r.blockId)}</code>`).join(' ')
    : '<span class="muted">无 —— 本次未识别到回忆段落</span>';

  // 文件改动 diff
  $('quick-files').innerHTML = (p.files || []).map((f) => `
    <div style="margin-bottom:8px">
      <div><strong>${escapeHtml(f.path)}</strong> <span class="tag">${f.action}</span></div>
      <pre class="diff">${escapeHtml((f.diff || '').slice(0, 1200))}${(f.diff || '').length > 1200 ? '\n…' : ''}</pre>
    </div>`).join('') || '<span class="muted">无文件改动</span>';
}

// ===== 编辑器（通用：日记/人物/后续扩充）=====
async function openEditor(rel, title) {
  currentEdit = { rel };
  $('editor-title').textContent = title + '  ·  ' + rel;
  $('tab-editor').classList.add('active');
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  $('tab-editor').classList.add('active');
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  document.querySelector('[data-tab="browse"]').classList.remove('active');
  $('editor-diff').classList.add('hidden');
  $('editor-save').disabled = true;
  $('editor-msg').textContent = '';
  // 加载原文
  const r = await api('/api/page?path=' + encodeURIComponent(rel));
  if (r.error) { $('editor-msg').textContent = '❌ ' + r.error; return; }
  $('editor-content').value = r.content;
  currentEdit.before = r.content;
}

$('editor-back').addEventListener('click', () => {
  $('tab-editor').classList.remove('active');
  $('tab-browse').classList.add('active');
  document.querySelector('[data-tab="browse"]').classList.add('active');
});

$('editor-preview').addEventListener('click', async () => {
  if (!currentEdit) return;
  const content = $('editor-content').value;
  const r = await api('/api/editor-preview', { path: currentEdit.rel, content });
  if (r.error) { $('editor-msg').textContent = '❌ ' + r.error; return; }
  $('editor-diff').classList.remove('hidden');
  $('editor-diff').textContent = r.diff;
  $('editor-save').disabled = false;
  $('editor-msg').textContent = '有改动：' + (r.before !== r.after ? '是' : '否（内容相同）');
});

$('editor-save').addEventListener('click', async () => {
  if (!currentEdit) return;
  const content = $('editor-content').value;
  const r = await api('/api/editor-save', { path: currentEdit.rel, content });
  if (r.error) { $('editor-msg').textContent = '❌ ' + r.error; return; }
  $('editor-msg').textContent = '✅ 已保存：' + r.saved;
  $('editor-save').disabled = true;
  loadIndex();
  loadEntities();
});

// 编辑器撤销：恢复到上次提交（HEAD）
$('editor-undo').addEventListener('click', async () => {
  if (!currentEdit) return;
  if (!confirm(`确定撤销对 ${currentEdit.rel} 的全部修改？将恢复到上次提交的状态。`)) return;
  const { results } = await api('/api/git-discard', { files: [currentEdit.rel] });
  const ok = results[0]?.discarded;
  if (!ok) { $('editor-msg').textContent = '❌ 撤销失败：' + (results[0]?.error || '未知错误'); return; }
  // 重新加载 HEAD 版本到编辑器
  const page = await api('/api/page?path=' + encodeURIComponent(currentEdit.rel));
  if (!page.error) {
    $('editor-content').value = page.content;
    currentEdit.before = page.content;
  }
  $('editor-diff').classList.add('hidden');
  $('editor-save').disabled = true;
  $('editor-msg').textContent = '✅ 已撤销，恢复到上次提交';
  loadIndex();
});

// ===== 浏览 =====
async function loadIndex() {
  const { index } = await api('/api/index');
  cachedIndex = index;
  renderBrowseStats(index);
  renderBrowseList(index);
}

function renderBrowseStats(idx) {
  const years = new Set(idx.diary.map((d) => d.year));
  $('browse-stats').innerHTML = `日记 ${idx.diary.length} 条 · 人物 ${idx.people.length} · 回忆 ${idx.recollections.length} · 页面 ${idx.nodes.length} · 年份 ${[...years].sort().join('/')}`;
}

function renderBrowseList(idx) {
  const year = $('browse-year').value;
  let entries = idx.diary;
  if (year) entries = entries.filter((d) => d.year === year);
  const list = $('browse-list');
  list.innerHTML = entries.length ? entries.slice().reverse().map((e) => `
    <div class="entry" data-date="${e.date}" data-file="${escapeHtml(e.file)}">
      <div class="date">${e.date}</div>
      <div class="preview">${escapeHtml(e.paras[0] || '')}</div>
      <div class="meta">${e.paras.length} 段 · ${escapeHtml(e.file)}</div>
    </div>`).join('') : '<div class="muted">该年份暂无日记</div>';

  list.querySelectorAll('.entry').forEach((el) => {
    el.addEventListener('click', () => showDiaryDetail(idx, el.dataset.date, el.dataset.file));
  });
}

function showDiaryDetail(idx, date, file) {
  const entry = idx.diary.find((d) => d.date === date);
  if (!entry) return;
  $('browse-list').classList.add('hidden');
  $('browse-stats').classList.add('hidden');
  const detail = $('browse-detail');
  detail.classList.remove('hidden');
  $('browse-detail-content').innerHTML = `
    <div class="detail-title">${entry.date}</div>
    ${entry.paras.map((p) => `<div class="detail-para">${escapeHtml(p)}</div>`).join('')}
    <div class="muted">来源：${escapeHtml(entry.file)}</div>`;
  currentBrowseFile = file || entry.file;
}

let currentBrowseFile = null;
$('browse-edit').addEventListener('click', () => {
  if (!currentBrowseFile) return;
  openEditor(currentBrowseFile, '编辑日记');
});

$('browse-back').addEventListener('click', () => {
  $('browse-detail').classList.add('hidden');
  $('browse-list').classList.remove('hidden');
  $('browse-stats').classList.remove('hidden');
});

$('browse-refresh').addEventListener('click', loadIndex);
$('browse-year').addEventListener('change', () => cachedIndex && renderBrowseList(cachedIndex));

// ===== 人物 =====
$('person-create').addEventListener('click', async () => {
  const name = $('person-name').value.trim();
  if (!name) return alert('请填写姓名');
  const aliases = $('person-aliases').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const body = { name, aliases, relation: $('person-relation').value.trim(), summary: $('person-summary').value.trim(), note: $('person-summary').value.trim() };
  const result = await api('/api/create-person', body);
  alert(`已创建人物：${result.name}`);
  $('person-name').value = ''; $('person-aliases').value = ''; $('person-relation').value = ''; $('person-summary').value = '';
  loadEntities();
});

async function loadEntities() {
  const { entities } = await api('/api/entities');
  $('entity-list').innerHTML = entities.length
    ? entities.map((e) => `<div class="entity-item" data-name="${escapeHtml(e.name)}" style="cursor:pointer;margin-bottom:6px"><span class="tag">${escapeHtml(e.name)}</span>${e.aliases.length ? ' ' + e.aliases.map((a) => `<span class="muted">${escapeHtml(a)}</span>`).join(' ') : ''} <span class="muted">✎</span></div>`).join('')
    : '暂无';
  $('entity-list').querySelectorAll('.entity-item').forEach((el) => {
    el.addEventListener('click', () => showPersonDetail(el.dataset.name));
  });
}

async function showPersonDetail(name) {
  const idx = cachedIndex;
  const person = idx && idx.people.find((p) => p.name === name);
  if (!person) return alert('找不到该人物');
  const { content } = await api('/api/page?path=' + encodeURIComponent(person.path));
  $('entity-list').classList.add('hidden');
  const d = $('person-detail');
  d.classList.remove('hidden');
  $('person-detail-content').innerHTML = `<pre style="white-space:pre-wrap;font-size:13px;font-family:ui-monospace,monospace;max-height:400px;overflow:auto">${escapeHtml(content)}</pre>`;
  currentPersonFile = person.path;
}

let currentPersonFile = null;
$('person-edit').addEventListener('click', () => {
  if (!currentPersonFile) return;
  openEditor(currentPersonFile, '编辑人物');
});

$('person-back').addEventListener('click', () => {
  $('person-detail').classList.add('hidden');
  $('entity-list').classList.remove('hidden');
});

// ===== git =====
let gitFiles = [];

$('git-status').addEventListener('click', async () => {
  const { status } = await api('/api/git-status');
  gitFiles = status;
  const byType = {};
  status.forEach((s) => { byType[s.status] = (byType[s.status] || 0) + 1; });
  const summary = Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' · ');
  $('git-result').innerHTML = status.length
    ? `<div class="muted" style="margin-bottom:6px">共 ${status.length} 个改动：${escapeHtml(summary)}</div>` +
      status.map((s) => `
      <div class="git-file">
        <span class="git-status-chip ${s.status}">${s.status}</span>
        <span class="git-path">${escapeHtml(s.filePath)}</span>
        <button class="undo-btn" data-file="${escapeHtml(s.filePath)}">撤销</button>
      </div>`).join('')
    : '工作区干净 ✓';

  // 绑定撤销按钮
  $('git-result').querySelectorAll('.undo-btn').forEach((btn) => {
    btn.addEventListener('click', () => showUndoModal(btn.dataset.file));
  });
});

// 撤销确认弹窗
let undoFile = null;
function showUndoModal(file) {
  undoFile = file;
  $('undo-modal-text').textContent = `确定撤销对 ${file} 的修改？将恢复到上次提交的状态，此操作不可恢复。`;
  $('undo-modal').classList.remove('hidden');
}

$('undo-cancel').addEventListener('click', () => {
  $('undo-modal').classList.add('hidden');
  undoFile = null;
});

$('undo-confirm').addEventListener('click', async () => {
  if (!undoFile) return;
  const { results } = await api('/api/git-discard', { files: [undoFile] });
  const ok = results[0]?.discarded;
  $('undo-modal').classList.add('hidden');
  $('git-status').click(); // 刷新
  loadIndex();
  if (ok) alert(`已撤销：${undoFile}`);
  else alert('撤销失败：' + (results[0]?.error || '未知错误'));
  undoFile = null;
});

// ===== 设置 =====
async function loadVaultInfo() {
  const { vault } = await api('/api/vault');
  $('vault-current').textContent = vault;
}

$('vault-save').addEventListener('click', async () => {
  const p = $('vault-path').value.trim();
  if (!p) return alert('请输入记忆库路径');
  const r = await api('/api/vault', { path: p });
  if (r.error) { $('vault-msg').textContent = '❌ ' + r.error; return; }
  $('vault-msg').textContent = '✅ 已切换，重新加载索引…';
  loadVaultInfo();
  loadIndex();
});

$('vault-reload').addEventListener('click', () => {
  loadVaultInfo();
  loadIndex();
  loadEntities();
  $('vault-msg').textContent = '已重新加载';
});

loadEntities();
loadIndex();
loadVaultInfo();
