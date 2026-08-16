// gitStore.js —— 浏览器端 git 数据层
// 用 isomorphic-git + lightning-fs（IndexedDB）在浏览器里维护记忆库仓库：
//   - 首次：clone 或 init + 配置 remote
//   - 常规：status → 编辑 → add/commit → push；pull
// 认证：GitHub token 通过 onAuth 传给 isomorphic-git，token 由调用方存入 localStorage。
// CORS：浏览器直连 GitHub git 端点会被 CORS 拦截（GitHub 不返回 access-control-allow-origin），
//       必须通过 CORS 代理（corsProxy）转发。isomorphic-git 原生支持 corsProxy 配置。
//       默认代理：https://cors.isomorphic-git.org（isomorphic-git 官方推荐）。
// 纯浏览器运行，不依赖 Node/服务器。

import * as git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import http from 'isomorphic-git/http/web';

// 仓库在浏览器 IndexedDB 里的根路径
const REPO_DIR = '/memory-graph';
const FS_NAME = 'memory-graph-repo';

// 默认 CORS 代理（isomorphic-git 官方）
export const DEFAULT_CORS_PROXY = 'https://cors.isomorphic-git.org';

let _fs = null;
export function getFs() {
  if (!_fs) _fs = new LightningFS(FS_NAME);
  return _fs;
}

// 重置 fs 实例缓存（清除缓存后调用，强制下次 getFs 重新创建）
export function resetFs() {
  _fs = null;
}

export function getRepoDir() {
  return REPO_DIR;
}

// 递归 mkdir（lightning-fs mkdir 无 recursive）
export async function mkdirp(fs, p) {
  const parts = String(p).split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { await fs.promises.mkdir(cur); } catch (e) {
      if (!String(e.message).includes('EEXIST')) throw e;
    }
  }
}

// 生成 onAuth 回调（返回 token）
export function makeOnAuth(token) {
  return () => ({ username: token, password: token });
}

// 组装 git 通用参数（fs + http + corsProxy）
function baseOpts(opts = {}) {
  const { corsProxy = DEFAULT_CORS_PROXY, token } = opts;
  const o = { fs: opts.fs || getFs(), http, dir: opts.dir || REPO_DIR };
  if (corsProxy) o.corsProxy = corsProxy;
  if (token) o.onAuth = makeOnAuth(token);
  return o;
}

// 检查仓库是否已初始化（是否有 .git）
export async function isRepoReady(fs) {
  try {
    await fs.promises.stat(REPO_DIR + '/.git');
    return true;
  } catch { return false; }
}

// 克隆远程仓库（首次）
export async function cloneRepo({ url, token, corsProxy, dir = REPO_DIR, ref = 'main' }) {
  const fs = getFs();
  await mkdirp(fs, dir);
  await git.clone({
    ...baseOpts({ fs, dir, token, corsProxy }),
    url,
    singleBranch: true,
    depth: 1,
    ref,
  });
  return { dir };
}

// 初始化空仓库并设置 remote（若无远程可 clone 时用）
export async function initRepo({ url, token, dir = REPO_DIR, defaultBranch = 'main' }) {
  const fs = getFs();
  await mkdirp(fs, dir);
  await git.init({ fs, dir, defaultBranch });
  if (url) {
    await git.addRemote({ fs, dir, remote: 'origin', url });
  }
  return { dir };
}

// 工作区状态
export async function status(fs, dir = REPO_DIR) {
  const matrix = await git.statusMatrix({ fs, dir });
  return matrix
    .map(([filepath, head, workdir, stage]) => ({ filePath: filepath, head, workdir, stage }))
    .filter((s) => !(s.head === 1 && s.workdir === 1 && s.stage === 1));
}

// 读取文件（相对仓库根）
export async function readFile(fs, relPath, dir = REPO_DIR) {
  return fs.promises.readFile(`${dir}/${relPath}`, 'utf8');
}

// 写入文件（相对仓库根）
export async function writeFile(fs, relPath, data, dir = REPO_DIR) {
  const full = `${dir}/${relPath}`;
  await mkdirp(fs, full.slice(0, full.lastIndexOf('/')));
  await fs.promises.writeFile(full, data);
}

// 提交全部改动
export async function commitAll(fs, { message, name, email, dir = REPO_DIR }) {
  // 暂存所有改动
  const matrix = await git.statusMatrix({ fs, dir });
  for (const [filepath, head, workdir] of matrix) {
    if (head === 0 && workdir === 0) continue; // 缺失
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath });
    } else {
      await git.add({ fs, dir, filepath });
    }
  }
  const sha = await git.commit({
    fs, dir, message,
    author: { name: name || 'memory-app', email: email || 'app@local' },
  });
  return sha;
}

// 推送（需要 corsProxy + token）
export async function push(fs, { token, corsProxy, remote = 'origin', ref = 'main', dir = REPO_DIR }) {
  return git.push({
    ...baseOpts({ fs, dir, token, corsProxy }),
    remote, ref,
  });
}

// 拉取
export async function pull(fs, { token, corsProxy, remote = 'origin', ref = 'main', dir = REPO_DIR }) {
  return git.pull({
    ...baseOpts({ fs, dir, token, corsProxy }),
    remote, ref,
    fastForwardOnly: true,
  });
}

// 日志
export async function log(fs, depth = 10, dir = REPO_DIR) {
  try {
    return await git.log({ fs, dir, depth });
  } catch { return []; }
}

// ===== 撤回 / 重做 / squash 推送 =====

// 获取"远端基准之后的本地 commit 栈"。
// 规则：以 refs/remotes/origin/main（或指定 remoteRef）为基准，返回基准之后的所有本地 commit。
// 例如远端有 0,1,2，本地又提交 3,4,5 → 返回 [3,4,5]（新的在后）。
// 若远端基准不存在（从未推送），返回全部本地 commit。
// 返回 [{ oid, message, parent }]（parent 为父 commit 的 oid 数组）。
export async function getLocalCommits(fs, opts = {}) {
  const { remote = 'origin', ref = 'main', dir = REPO_DIR } = opts;
  // 远端基准 oid
  let baseOid = null;
  try {
    baseOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remote}/${ref}` });
  } catch { baseOid = null; }

  const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
  // 从 HEAD 沿 parent 链回溯，收集直到（不含）baseOid 的 commit
  const stack = [];
  let cur = headOid;
  while (cur && cur !== baseOid) {
    const { commit } = await git.readCommit({ fs, dir, oid: cur });
    stack.unshift({ oid: cur, message: commit.message, parent: commit.parent });
    if (!commit.parent.length) break;
    cur = commit.parent[0];
  }
  return stack;
}

// 撤回到指定 commit：把工作区 + index 恢复到该 commit 的文件状态。
// 只改工作区/暂存区，不删除 commit（commit 仍在 git 对象库，可重做）。
export async function undoToCommit(fs, { commitHash, dir = REPO_DIR }) {
  // 1. checkout 恢复工作区文件到目标 commit（force 覆盖本地未提交改动）
  await git.checkout({ fs, dir, ref: commitHash, force: true });
  // 2. resetIndex 让暂存区与工作区一致（index 与目标 commit 匹配）
  try {
    await git.resetIndex({ fs, dir, filepath: '.' });
  } catch { /* 某些版本 resetIndex 对 '.' 有限制，忽略，checkout 已恢复工作区 */ }
  return { commitHash };
}

// 重做（取消撤回）：恢复到目标 commit 的文件状态。逻辑同 undo，只是目标为"更晚"的 commit。
export async function redoToCommit(fs, { commitHash, dir = REPO_DIR }) {
  await git.checkout({ fs, dir, ref: commitHash, force: true });
  try {
    await git.resetIndex({ fs, dir, filepath: '.' });
  } catch { /* 忽略 */ }
  return { commitHash };
}

// squash 推送：把"远端基准之后的所有本地 commit"合并成一个 commit 并推送到远端。
// - 新 commit 的 tree = 当前 HEAD 的 tree（即全部本地改动的最终状态）
// - 新 commit 的 parent = 远端基准（refs/remotes/origin/main）
// - 这样远端只增加 1 个 commit，本地多个"落盘节点"被压缩为一次推送。
// 返回 { pushedSha, baseOid }；若无本地改动则返回 null（不推送）。
export async function squashPush(fs, { token, corsProxy, remote = 'origin', ref = 'main', dir = REPO_DIR, message }) {
  // 远端基准
  let baseOid = null;
  try {
    baseOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remote}/${ref}` });
  } catch { baseOid = null; }

  const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
  // 若 HEAD 就是远端基准，说明没有任何本地改动 → 不推送
  if (headOid === baseOid) {
    return null;
  }
  const headCommit = await git.readCommit({ fs, dir, oid: headOid });

  const author = { name: 'memory-app', email: 'app@local', timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
  const parent = baseOid ? [baseOid] : headCommit.commit.parent;
  const squashOid = await git.writeCommit({ fs, dir, commit: {
    tree: headCommit.commit.tree,
    parent,
    message: message || `记忆更新`,
    author,
    committer: author,
  } });
  // 移动本地分支到 squash commit
  await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: squashOid, force: true });
  // 推送
  await git.push({
    ...baseOpts({ fs, dir, token, corsProxy }),
    remote, ref,
  });
  return { pushedSha: squashOid, baseOid };
}

export default { getFs, getRepoDir, isRepoReady, cloneRepo, initRepo, status, readFile, writeFile, commitAll, push, pull, log, mkdirp, DEFAULT_CORS_PROXY, getLocalCommits, undoToCommit, redoToCommit, squashPush, resetFs };
