// app.js —— 记忆库 PWA 逻辑
// 复用 src/lib 的链接引擎/索引，git 数据层用 gitStore（lightning-fs + isomorphic-git）。
// 记忆库仓库克隆到 IndexedDB，编辑后 commit + push 回 GitHub。
import gitStore from '../src/lib/gitStore.js';
import * as git from 'isomorphic-git';
import { createProposal } from '../src/lib/linkEngine.js';
import { applyProposal } from '../src/lib/applier.js';
import { indexVault } from '../src/lib/vaultIndex.js';
import { loadEntityDict } from '../src/lib/entityDict.js';
import { replaceDateSection, parseFrontmatter } from '../src/lib/markdown.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'memory-graph-config';

// ===== 配置持久化（localStorage） =====
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// 记忆库根：gitStore 仓库根就是记忆库根（linkEngine 内部会拼 记忆/）
const VAULT_ROOT = () => gitStore.getRepoDir();

// 轻量 fs 适配（gitStore 的 fs 的 promisified 接口）
function vaultFs() {
  const fs = gitStore.getFs();
  return {
    readFile: (p) => fs.promises.readFile(p, 'utf8'),
    writeFile: async (p, d) => { await gitStore.mkdirp(fs, p.slice(0, p.lastIndexOf('/'))); await fs.promises.writeFile(p, d); },
    exists: async (p) => { try { await fs.promises.stat(p); return true; } catch { return false; } },
    listDir: (p) => fs.promises.readdir(p),
    mkdir: (p) => gitStore.mkdirp(fs, p),
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== 连接仓库 =====
$('btn-connect').addEventListener('click', async () => {
  const url = $('repo-url').value.trim();
  const token = $('token').value.trim();
  if (!url || !token) { $('setup-msg').textContent = '请填写仓库 URL 和 Token'; return; }
  $('setup-msg').textContent = '正在克隆仓库…（首次可能较慢）';
  try {
    const cfg = loadConfig();
    cfg.repoUrl = url;
    cfg.token = token;
    cfg.corsProxy = $('cors-proxy').value.trim() || gitStore.DEFAULT_CORS_PROXY;
    saveConfig(cfg);
    // 若本地已有仓库，直接尝试连接（不重复 clone）；否则 clone
    const fs = gitStore.getFs();
    if (await gitStore.isRepoReady(fs)) {
      $('setup-msg').textContent = '✅ 本地已有仓库，直接使用';
    } else {
      await gitStore.cloneRepo({ url, token, corsProxy: cfg.corsProxy });
      $('setup-msg').textContent = '✅ 仓库已就绪';
    }
    refreshSettings();
    switchTab('quick');
    loadIndex();
    loadEntities();
    refreshGit();
  } catch (e) {
    $('setup-msg').textContent = '❌ ' + (e.message || '连接失败');
  }
});

// ===== Tab 切换 =====
const TITLES = { quick: '记录今天', browse: '记忆库', git: 'git 同步', settings: '设置' };
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-page').forEach((p) => p.classList.remove('active'));
  $('page-' + tab).classList.add('active');
  $('main-title').textContent = TITLES[tab] || '记忆库';
  // 未连接时，记录/记忆库/git 页显示提示
  if (tab !== 'settings' && !isConnected()) {
    showNotConnected(tab);
    return;
  }
  // 切到浏览时确保列表加载，切到 git 时刷新状态，切到设置时刷新仓库信息
  if (tab === 'browse' && window._idx) renderBrowseList(window._idx);
  if (tab === 'git') refreshGit();
  if (tab === 'settings') refreshSettings();
}

// 是否已连接（本地有仓库副本）
function isConnected() {
  try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

// 未连接时显示提示
function showNotConnected(tab) {
  const map = {
    quick: '请先在"设置"里连接 GitHub 仓库',
    browse: '请先在"设置"里连接 GitHub 仓库',
    git: '请先在"设置"里连接 GitHub 仓库',
  };
  const targets = {
    quick: ['quick-text', 'quick-preview', 'quick-apply', 'quick-date'],
    browse: ['browse-list', 'browse-stats', 'browse-year', 'browse-refresh'],
    git: ['btn-commit', 'btn-push', 'git-status', 'undo-info', 'commit-history', 'btn-undo', 'btn-redo', 'git-refresh'],
  };
  if (targets[tab]) targets[tab].forEach((id) => { const el = $(id); if (el) el.innerHTML = el.innerHTML; });
  // 显示提示
  if (tab === 'quick') $('quick-links').innerHTML = `<div class="muted">${map[tab]}</div>`;
  if (tab === 'browse') $('browse-list').innerHTML = `<div class="muted">${map[tab]}</div>`;
  if (tab === 'git') $('git-status').innerHTML = `<div class="muted">${map[tab]}</div>`;
}

// ===== 主界面 =====
function showMain() {
  $('quick-date').value = todayStr();
  loadIndex();
  loadEntities();
  refreshGit();
}

// ===== 今日速记 =====
// 按钮状态：默认只显示"生成链接"；点击生成后出现"确认落盘"；文本一改就重置回"生成链接"
function resetQuickButtons() {
  $('quick-preview').classList.remove('hidden');
  $('quick-apply').classList.add('hidden');
  window._currentProposal = null;
  $('quick-result').classList.add('hidden');
}

$('quick-preview').addEventListener('click', async () => {
  const text = $('quick-text').value.trim();
  if (!text) return alert('请输入内容');
  try {
    const proposal = await createProposal(vaultFs(), VAULT_ROOT(), { text, date: $('quick-date').value || undefined });
    renderProposal(proposal);
    window._currentProposal = proposal;
    // 隐藏"生成链接"，显示"确认落盘"
    $('quick-preview').classList.add('hidden');
    $('quick-apply').classList.remove('hidden');
    $('quick-result').classList.remove('hidden');
  } catch (e) {
    alert('生成链接失败：' + e.message);
  }
});

// 文本修改 → 重置按钮为"生成链接"（之前的提案作废）
$('quick-text').addEventListener('input', resetQuickButtons);

$('quick-apply').addEventListener('click', async () => {
  const proposal = window._currentProposal;
  if (!proposal) return;
  try {
    // 注意：applyProposal 需要 vaultRoot 参数做越界校验
    const applied = await applyProposal(vaultFs(), VAULT_ROOT(), proposal);
    // 落盘后立即 commit（产生一个本地节点；推送在 git 页单独进行）
    const fs = gitStore.getFs();
    const msg = `落盘 ${todayStr()}`;
    await gitStore.commitAll(fs, { message: msg, name: 'memory-app', email: 'app@local' });
    alert(`已落盘 ${applied.length} 个文件并提交（在 git 页点"推送"上传到 GitHub）`);
    $('quick-text').value = '';
    resetQuickButtons();
    loadIndex();
    refreshGit();
  } catch (e) {
    alert('落盘失败：' + e.message);
  }
});

function renderProposal(p) {
  $('quick-links').innerHTML = (p.generatedLinks || []).map((g) =>
    `<div><span class="tag">段</span> ${escapeHtml(g.para)} → ${(g.names || []).map((n) => `<span class="tag">${n}</span>`).join(' ') || '<span class="muted">无命中</span>'}</div>`
  ).join('');
}

// ===== 浏览（分页 + 年份筛选） =====
const PAGE_SIZE = 10;
let browseState = { page: 1, year: '' };

async function loadIndex() {
  try {
    const idx = await indexVault(vaultFs(), VAULT_ROOT());
    window._idx = idx;
    // 年份筛选下拉
    const years = [...new Set(idx.diary.map((d) => d.year))].sort();
    const sel = $('browse-year');
    sel.innerHTML = '<option value="">全部年份</option>' + years.map((y) => `<option value="${y}">${y}年</option>`).join('');
    sel.value = browseState.year;
    const yearsDesc = years.join('/');
    $('browse-stats').textContent = `日记 ${idx.diary.length} 条 · 人物 ${idx.people.length} · 回忆 ${idx.recollections.length} · ${yearsDesc || '无年份'}`;
    renderBrowseList(idx);
  } catch (e) {
    $('browse-stats').textContent = '❌ ' + (e.message || '索引失败');
  }
}

function filteredDiary(idx) {
  let entries = idx.diary;
  if (browseState.year) entries = entries.filter((d) => String(d.year) === String(browseState.year));
  return entries.slice().reverse(); // 新的在前
}

function renderBrowseList(idx) {
  const entries = filteredDiary(idx);
  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (browseState.page > totalPages) browseState.page = totalPages;

  const start = (browseState.page - 1) * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);

  $('browse-list').innerHTML = pageEntries.length
    ? pageEntries.map((e) => `
      <div class="entry" data-date="${e.date}" data-file="${escapeHtml(e.file)}">
        <div class="date">${e.date}</div>
        <div class="preview">${escapeHtml(e.paras[0] || '')}</div>
        <div class="meta">${e.paras.length} 段</div>
      </div>`).join('')
    : '<div class="muted">该年份暂无日记</div>';

  // 条目点击 → 打开详情视图
  $('browse-list').querySelectorAll('.entry').forEach((el) => {
    el.addEventListener('click', () => openDateDetail(el.dataset.date, el.dataset.file));
  });

  // 分页信息
  $('page-info').textContent = total ? `${browseState.page}/${totalPages}` : '0/0';
  $('page-prev').disabled = browseState.page <= 1;
  $('page-next').disabled = browseState.page >= totalPages;
}

// ===== 日期详情视图（展示 + 编辑 + 修改历史） =====
let currentDetail = null; // { date, file }
let detailData = null;    // 当前展示的段落数组

// 进入详情：压入浏览器历史（支持侧滑返回）
async function openDateDetail(date, file) {
  currentDetail = { date, file };
  $('detail-title').textContent = date;
  try {
    const full = await gitStore.readFile(gitStore.getFs(), file);
    const { body } = parseFrontmatter(full);
    // 提取该日期节的段落（不含标题，去掉块 ID 后缀用于展示）
    const paras = [];
    const lines = body.split('\n');
    let inSection = false;
    for (const line of lines) {
      const m = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
      if (m) {
        if (inSection) break;
        if (m[1] === date) inSection = true;
        continue;
      }
      if (inSection && line.trim() && !/^#/.test(line)) {
        // 去掉行尾块 ID 用于展示（^xxx）
        paras.push(line.trim().replace(/\s+\^[a-z][a-z0-9-]*\s*$/, ''));
      }
    }
    detailData = paras;
    // 默认只读展示
    showDetailReadonly();
    // 切到详情视图 + 压入历史栈
    $('browse-view-list').classList.add('hidden');
    $('browse-view-detail').classList.remove('hidden');
    history.pushState({ detail: { date, file } }, '');
    loadDetailHistory();
  } catch (e) {
    alert('读取失败：' + (e.message || '未知错误'));
  }
}

// 只读展示（段落渲染为 HTML）
function showDetailReadonly() {
  $('detail-editor').classList.add('hidden');
  $('detail-view').classList.remove('hidden');
  $('detail-msg').textContent = '';
  $('detail-view').innerHTML = detailData && detailData.length
    ? detailData.map((p) => `<p class="detail-para">${escapeHtml(p)}</p>`).join('')
    : '<div class="muted">该日期暂无内容</div>';
}

// 编辑模式（点击"修改"）
function showDetailEditor() {
  $('detail-view').classList.add('hidden');
  $('detail-editor').classList.remove('hidden');
  $('detail-msg').textContent = '';
  $('detail-content').value = (detailData || []).join('\n\n');
}

// 返回列表（恢复浏览器历史，使侧滑返回也能生效）
function closeDetail() {
  currentDetail = null;
  detailData = null;
  $('browse-view-detail').classList.add('hidden');
  $('browse-view-list').classList.remove('hidden');
}

$('detail-back').addEventListener('click', () => {
  // 若正在编辑，先退出编辑模式；否则返回列表
  if (!$('detail-editor').classList.contains('hidden')) {
    showDetailReadonly();
  } else if (window.history.length > 1) {
    history.back();
  } else {
    closeDetail();
  }
});

// 浏览器返回（侧滑/物理键）→ 回到列表
window.addEventListener('popstate', () => {
  closeDetail();
});

// 点"修改"进入编辑
$('detail-edit').addEventListener('click', showDetailEditor);

// 取消编辑
$('detail-cancel').addEventListener('click', showDetailReadonly);

// 加载该文件的修改历史（git log 按文件过滤）
async function loadDetailHistory() {
  if (!currentDetail) return;
  $('detail-history').innerHTML = '<span class="muted">加载中…</span>';
  try {
    const hist = await gitStore.fileHistory(gitStore.getFs(), currentDetail.file, 20);
    $('detail-history').innerHTML = hist.length
      ? hist.map((h) => {
          const d = new Date(h.timestamp * 1000);
          const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          return `<div class="commit-row">
            <span class="commit-dot">●</span>
            <span class="commit-msg">${escapeHtml(h.message.trim())}</span>
            <span class="muted">${ds}</span>
          </div>`;
        }).join('')
      : '<div class="muted">暂无修改历史</div>';
  } catch {
    $('detail-history').innerHTML = '<div class="muted">暂无修改历史</div>';
  }
}

$('detail-back').addEventListener('click', () => {
  currentDetail = null;
  $('browse-view-detail').classList.add('hidden');
  $('browse-view-list').classList.remove('hidden');
});

// 保存修改：替换该日期节 → 写回文件 → 自动 commit
$('detail-save').addEventListener('click', async () => {
  if (!currentDetail) return;
  const newBody = $('detail-content').value;
  try {
    const fs = gitStore.getFs();
    const full = await gitStore.readFile(fs, currentDetail.file);
    const replaced = replaceDateSection(full, currentDetail.date, newBody);
    if (replaced === null) { alert('该日期不存在，无法修改'); return; }
    // 写回文件（相对仓库根）
    await gitStore.writeFile(fs, currentDetail.file, replaced);
    // 自动 commit（留下修改历史）
    await gitStore.commitAll(fs, { message: `修改 ${currentDetail.date}`, name: 'memory-app', email: 'app@local' });
    // 更新展示数据并回到只读模式
    const paras = newBody.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    detailData = paras;
    showDetailReadonly();
    $('detail-msg').textContent = '✅ 已保存并提交';
    loadDetailHistory();
    loadIndex(); // 刷新列表
  } catch (e) {
    alert('保存失败：' + (e.message || '未知错误'));
  }
});

$('page-prev').addEventListener('click', () => {
  if (browseState.page > 1) { browseState.page--; if (window._idx) renderBrowseList(window._idx); }
});
$('page-next').addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(filteredDiary(window._idx).length / PAGE_SIZE));
  if (browseState.page < totalPages) { browseState.page++; if (window._idx) renderBrowseList(window._idx); }
});
$('browse-year').addEventListener('change', (e) => {
  browseState.year = e.target.value;
  browseState.page = 1;
  if (window._idx) renderBrowseList(window._idx);
});
$('browse-refresh').addEventListener('click', loadIndex);

async function loadEntities() {
  try {
    const entities = await loadEntityDict(vaultFs(), VAULT_ROOT());
    window._entities = entities;
  } catch { /* 忽略 */ }
}

// ===== git 同步 =====
// undo/redo 栈：以"远端基准之后的本地 commit"为节点。
// - undoStack：本地未推送的 commit（从旧到新，stack 尾部是最新）
// - redoStack：被撤回的 commit（可重做）
let undoStack = [];
let redoStack = [];

// 刷新 git 状态 + 撤回栈 + 落盘历史
async function refreshGit() {
  try {
    const fs = gitStore.getFs();
    const st = await gitStore.status(fs);
    const dirty = st.some((s) => !(s.head === 1 && s.workdir === 1 && s.stage === 1));
    // 顶部状态：有未提交改动 / 干净
    $('git-status').innerHTML = dirty
      ? '<span class="tag">●</span> 有未提交的落盘改动，点"提交改动"'
      : '工作区干净 ✓';
    await refreshUndoStack();
    renderCommitHistory();
  } catch (e) {
    alert('刷新 git 状态失败：' + (e.message || '未知错误'));
  }
}

// 重新计算 undo/redo 栈（以远端基准为界，不越过）
async function refreshUndoStack() {
  try {
    const fs = gitStore.getFs();
    const locals = await gitStore.getLocalCommits(fs);
    undoStack = locals;
    $('undo-info').textContent = `本地待推送 ${undoStack.length} 个节点`;
    $('btn-undo').disabled = undoStack.length === 0;
    $('btn-redo').disabled = redoStack.length === 0;
  } catch (e) {
    $('undo-info').textContent = `本地待推送 ${undoStack.length} 个节点`;
  }
}

// 渲染"落盘记录"：显示每次落盘（commit 节点）
function renderCommitHistory() {
  const all = [...undoStack, ...redoStack].sort((a, b) => (a.oid === b.oid ? 0 : 0)); // 保持原顺序展示
  if (!undoStack.length && !redoStack.length) {
    $('commit-history').innerHTML = '<div class="muted">暂无本地落盘记录（提交推送后即同步到 GitHub）</div>';
    return;
  }
  // 显示 undo 栈（按从旧到新）+ redo 栈（标记为已撤回）
  const rows = [];
  undoStack.forEach((c, i) => {
    const isLatest = i === undoStack.length - 1;
    rows.push(`<div class="commit-row ${isLatest ? 'latest' : ''}">
      <span class="commit-dot">●</span>
      <span class="commit-msg">${escapeHtml(c.message.trim())}</span>
      <span class="muted">${isLatest ? '最新' : ''}</span>
    </div>`);
  });
  redoStack.slice().reverse().forEach((c) => {
    rows.push(`<div class="commit-row redo">
      <span class="commit-dot">○</span>
      <span class="commit-msg">${escapeHtml(c.message.trim())}</span>
      <span class="muted">已撤回</span>
    </div>`);
  });
  $('commit-history').innerHTML = rows.join('');
}

$('git-refresh').addEventListener('click', refreshGit);

// 提交改动：把当前未提交的工作区改动提交为一个节点（不推送）
$('btn-commit').addEventListener('click', async () => {
  try {
    const fs = gitStore.getFs();
    const st = await gitStore.status(fs);
    const dirty = st.some((s) => !(s.head === 1 && s.workdir === 1 && s.stage === 1));
    if (!dirty) { alert('没有未提交的改动'); return; }
    $('git-status').textContent = '正在提交…';
    await gitStore.commitAll(fs, { message: `落盘 ${todayStr()}`, name: 'memory-app', email: 'app@local' });
    $('git-status').textContent = '✅ 已提交为一个节点（点"推送"上传到 GitHub）';
    refreshGit();
  } catch (e) {
    $('git-status').textContent = '❌ ' + (e.message || '提交失败');
  }
});

// 推送：把本地所有未推送的节点合并为一个 commit，推送到远端基准之上
$('btn-push').addEventListener('click', async () => {
  const cfg = loadConfig();
  if (!cfg.token) { alert('缺少 Token，请重新连接'); return; }
  try {
    const fs = gitStore.getFs();
    // 先算本地待推送节点 + 未提交改动
    const locals = await gitStore.getLocalCommits(fs);
    const st = await gitStore.status(fs);
    const dirty = st.some((s) => !(s.head === 1 && s.workdir === 1 && s.stage === 1));
    // 没有待推送节点也没有未提交改动 → 无可推送内容，提示后返回（避免错误）
    if (locals.length === 0 && !dirty) {
      alert('没有可推送的内容（本地没有待推送的落盘记录）');
      return;
    }
    // 若有未提交改动，先自动提交
    if (dirty) {
      $('git-status').textContent = '正在提交工作区改动…';
      await gitStore.commitAll(fs, { message: `落盘 ${todayStr()}`, name: 'memory-app', email: 'app@local' });
    }
    $('git-status').textContent = '正在合并并推送…';
    await gitStore.squashPush(fs, {
      token: cfg.token,
      corsProxy: cfg.corsProxy || gitStore.DEFAULT_CORS_PROXY,
      message: `推送 ${todayStr()}`,
    });
    $('git-status').textContent = '✅ 已合并为 1 个 commit 并推送到 GitHub';
    undoStack = [];
    redoStack = [];
    refreshGit();
  } catch (e) {
    alert('推送失败：' + (e.message || '未知错误'));
    $('git-status').textContent = '推送失败，请重试';
  }
});

// 撤回：把工作区恢复到上一个"落盘节点"（不越过远端基准）
$('btn-undo').addEventListener('click', async () => {
  const fs = gitStore.getFs();
  const dir = gitStore.getRepoDir();
  if (undoStack.length === 0) { alert('没有可撤回的节点（不能越过远端最新记录）'); return; }
  // 要撤回到的目标：当前栈的倒数第二个节点；若只剩 1 个，目标 = 远端基准（HEAD 的父）
  const target = undoStack.length >= 2 ? undoStack[undoStack.length - 2] : null;
  const commitToDrop = undoStack[undoStack.length - 1];
  const confirmMsg = target
    ? `将撤回"${commitToDrop.message.trim()}"，恢复到节点 ${undoStack.length - 1} 的状态。\n（不影响已推送到 GitHub 的记录）`
    : `将撤回"${commitToDrop.message.trim()}"，恢复到远端最新记录的状态。\n（不影响已推送到 GitHub 的记录）`;
  if (!confirm(confirmMsg)) return;
  try {
    if (target) {
      await gitStore.undoToCommit(fs, { commitHash: target.oid, dir });
    } else {
      // 只剩 1 个节点：恢复到远端基准（HEAD 的父 commit）
      const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
      const { commit } = await git.readCommit({ fs, dir, oid: headOid });
      if (!commit.parent.length) { alert('没有更早的节点可撤回'); return; }
      await gitStore.undoToCommit(fs, { commitHash: commit.parent[0], dir });
    }
    // 移动栈：被撤回的节点从 undo 移到 redo
    redoStack.push(undoStack.pop());
    refreshGit();
    loadIndex();
    alert('✅ 已撤回。如需恢复，点"取消撤回"。');
  } catch (e) {
    alert('撤回失败：' + (e.message || '未知错误'));
  }
});

// 重做（取消撤回）
$('btn-redo').addEventListener('click', async () => {
  const fs = gitStore.getFs();
  const dir = gitStore.getRepoDir();
  if (redoStack.length === 0) { alert('没有可恢复的撤回'); return; }
  const commitToRestore = redoStack[redoStack.length - 1];
  try {
    await gitStore.redoToCommit(fs, { commitHash: commitToRestore.oid, dir });
    undoStack.push(redoStack.pop());
    refreshGit();
    loadIndex();
    alert('✅ 已恢复。');
  } catch (e) {
    alert('恢复失败：' + (e.message || '未知错误'));
  }
});

// ===== 设置 =====
function refreshSettings() {
  const cfg = loadConfig();
  // 连接状态提示
  const connected = cfg.repoUrl && cfg.token;
  $('settings-conn-state').innerHTML = connected
    ? `<span class="tag">● 已连接</span> <code>${escapeHtml(cfg.repoUrl)}</code>`
    : '<span class="tag">○ 未连接</span> 填写仓库信息后点"连接仓库"';
  // 回填已保存的配置
  if (cfg.repoUrl) $('repo-url').value = cfg.repoUrl;
  if (cfg.token) $('token').value = cfg.token;
  if (cfg.corsProxy) $('cors-proxy').value = cfg.corsProxy;
}

// 清除缓存：清空 IndexedDB 仓库 + localStorage 配置，回到未连接状态（留在设置页）
$('btn-clear-cache').addEventListener('click', async () => {
  if (!confirm('确定清除本地缓存？\n\n将删除浏览器本地保存的记忆库副本和连接配置。\n（不会删除 GitHub 上的数据，重新"连接仓库"即可恢复）')) return;
  try {
    $('settings-msg').textContent = '正在清除…';
    // 1. 清 localStorage 配置
    localStorage.removeItem(STORAGE_KEY);
    // 2. 删除 lightning-fs 的 IndexedDB 数据库
    try {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('memory-graph-repo');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    } catch { /* 忽略 */ }
    // 3. 重置 gitStore 内部 fs 实例缓存（下次 getFs 重新创建）
    gitStore.resetFs();
    // 4. 清空输入框 + 刷新界面状态
    $('repo-url').value = '';
    $('token').value = '';
    $('cors-proxy').value = '';
    $('setup-msg').textContent = '';
    $('settings-msg').textContent = '✅ 缓存已清除，请重新连接仓库';
    refreshSettings();
    switchTab('settings');
  } catch (e) {
    $('settings-msg').textContent = '❌ ' + (e.message || '清除失败');
  }
});

// ===== 初始化 =====
(async function init() {
  $('quick-date').value = todayStr();
  const cfg = loadConfig();
  if (cfg.repoUrl && cfg.token) {
    $('repo-url').value = cfg.repoUrl;
    $('token').value = cfg.token;
    if (cfg.corsProxy) $('cors-proxy').value = cfg.corsProxy;
    // 尝试检测是否已克隆
    try {
      const fs = gitStore.getFs();
      if (await gitStore.isRepoReady(fs)) {
        showMain();
        refreshSettings();
        return;
      }
    } catch { /* 未就绪，走连接流程 */ }
  }
  // 未连接：默认停在设置页
  refreshSettings();
  switchTab('settings');
})();
