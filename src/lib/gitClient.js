// gitClient.js —— git 客户端层
// 用 isomorphic-git 实现 status / diff / commit / push / pull / discard。
//
// isomorphic-git 需要完整的 fs API（readFile/writeFile/unlink/rmdir/readdir/mkdir/stat 等）。
// Node 环境下：若调用方传入完整 fs（有 stat/unlink/readdir）则直接用；
// 否则退化为 node:fs（保证 dev-server / 测试里 git 操作真实可用）。
//
// 沿用"先预览后确认"：所有写操作（commit/push/pull/discard）只返回"将要做什么"，由 UI 确认后执行。

import * as git from 'isomorphic-git';
import nodeFs from 'node:fs';

function isGitFs(fs) {
  return fs && typeof fs.stat === 'function' && typeof fs.unlink === 'function' && typeof fs.readdir === 'function';
}

// 解析传入的 fs：非完整 git fs（如 dev-server 的瘦 nodeFs）时退化为 node:fs
function resolveFs(fs) {
  if (isGitFs(fs)) return fs;
  return nodeFs;
}

// 判断是否已初始化仓库
export async function isRepo(fs, dir) {
  const gfs = resolveFs(fs);
  try {
    await git.getConfig({ fs: gfs, dir, path: 'user.name' });
    return true;
  } catch { return false; }
}

export async function initRepo(fs, dir, { userName, userEmail }) {
  const gfs = resolveFs(fs);
  await git.init({ fs: gfs, dir, defaultBranch: 'main' });
  await git.setConfig({ fs: gfs, dir, path: 'user.name', value: userName });
  await git.setConfig({ fs: gfs, dir, path: 'user.email', value: userEmail });
}

// 状态标签（依据 isomorphic-git statusMatrix 语义）
// [filepath, head, workdir, stage]
//   head:    0 缺 / 1 在
//   workdir: 0 缺 / 1 同 index / 2 异于 index
//   stage:   0 缺 / 1 同 HEAD / 2 异于 HEAD / 3 同 workdir
function labelStatus(head, workdir, stage) {
  if (head === 0 && workdir === 0) return 'absent';
  if (head === 0 && stage === 0) return 'untracked';      // [0,2,0]
  if (head === 0) return 'added';                          // 已暂存的新文件 [0,2,2]
  if (workdir === 0) return 'deleted';                     // [1,0,1]
  if (workdir === 2) {
    return stage === 2 ? 'staged' : 'modified';            // [1,2,2] 已暂存 / [1,2,1] 仅工作区改动
  }
  if (stage === 2) return 'staged';                        // [1,1,2] index 异于 HEAD（少见）
  return 'unmodified';                                     // [1,1,1] 干净
}

// 状态：返回工作区改动 [{filePath, status}]
export async function status(fs, dir) {
  const gfs = resolveFs(fs);
  try {
    const res = await git.statusMatrix({ fs: gfs, dir });
    return res
      .map(([filepath, head, workdir, stage]) => ({
        filePath: filepath, head, workdir, stage,
        status: labelStatus(head, workdir, stage),
      }))
      .filter((s) => s.status !== 'unmodified' && s.status !== 'absent');
  } catch (e) {
    return [];
  }
}

// 读某个文件的工作区内容（相对路径）
export async function fileContent(fs, dir, relPath) {
  const gfs = resolveFs(fs);
  try {
    return await gfs.readFile(`${dir}/${relPath}`, 'utf8');
  } catch { return null; }
}

export async function commit(fs, dir, { message, author }) {
  const gfs = resolveFs(fs);
  const sha = await git.commit({
    fs: gfs, dir, message,
    author: { name: author.name, email: author.email, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 },
  });
  return sha;
}

// 添加文件
export async function addAll(fs, dir, filePaths) {
  const gfs = resolveFs(fs);
  for (const p of filePaths) {
    try {
      await git.add({ fs: gfs, dir, filepath: p });
    } catch { /* 跳过无法 add 的 */ }
  }
}

// 推送（需要 remote 已配置；onAuth 处理凭据）
export async function push(fs, dir, { remote = 'origin', ref = 'main', onAuth }) {
  const gfs = resolveFs(fs);
  return await git.push({ fs: gfs, dir, remote, ref, onAuth });
}

// 拉取
export async function pull(fs, dir, { remote = 'origin', ref = 'main', onAuth, fastForwardOnly = true }) {
  const gfs = resolveFs(fs);
  return await git.pull({ fs: gfs, dir, remote, ref, fastForwardOnly, onAuth });
}

// 设置远程
export async function setRemote(fs, dir, { remote = 'origin', url }) {
  const gfs = resolveFs(fs);
  await git.addRemote({ fs: gfs, dir, remote, url });
}

// 获取远程 URL（isomorphic-git 无 getRemote，用 listRemotes）
export async function getRemote(fs, dir, remote = 'origin') {
  const gfs = resolveFs(fs);
  try {
    const remotes = await git.listRemotes({ fs: gfs, dir });
    const found = remotes.find((r) => r.remote === remote);
    return found ? found.url : null;
  } catch { return null; }
}

// 日志
export async function log(fs, dir, depth = 10) {
  const gfs = resolveFs(fs);
  try {
    return await git.log({ fs: gfs, dir, depth });
  } catch { return []; }
}

// 撤销对指定文件的未提交改动：
//   - 已跟踪文件：checkout 恢复到 HEAD
//   - 未跟踪文件（head === 0）：直接删除
export async function discard(fs, dir, filePaths) {
  const gfs = resolveFs(fs);
  const results = [];
  const matrix = await git.statusMatrix({ fs: gfs, dir });
  const byPath = new Map(matrix.map((r) => [r[0], r]));
  for (const p of filePaths) {
    try {
      const row = byPath.get(p);
      const head = row ? row[1] : 0;
      if (head === 0) {
        // 未跟踪文件：删除
        await gfs.unlink(`${dir}/${p}`);
      } else {
        // 已跟踪文件：恢复到 HEAD
        await git.checkout({ fs: gfs, dir, filepaths: [p], force: true });
      }
      results.push({ filePath: p, discarded: true });
    } catch (e) {
      results.push({ filePath: p, discarded: false, error: e.message });
    }
  }
  return results;
}

export default { isRepo, initRepo, status, commit, addAll, push, pull, setRemote, getRemote, log, fileContent, discard };
