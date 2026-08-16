// applier.js —— 变更应用器
// 把链接引擎的 proposal 落到磁盘。
// 调用方（UI）应先展示 proposal 的 files[] diff 预览，确认后调用 applyProposal。
// 安全：applyProposal 内部校验所有落盘路径必须在 vaultRoot 内（防御性，不依赖调用方）。

import { dirname, resolve } from './pathUtil.js';
import { mkdir, writeFileText } from './fsCompat.js';

/**
 * 把 proposal 落到磁盘。
 * @param {object} fs 文件系统适配器（readFile/writeFile/exists/listDir/mkdir）
 * @param {string} vaultRoot 记忆库根目录（用于路径越界校验）
 * @param {object} proposal { files: [{path|fullPath, action, before, after}] }
 */
export async function applyProposal(fs, vaultRoot, proposal) {
  const applied = [];
  for (const f of proposal.files) {
    const target = f.fullPath || f.path;
    // 路径越界防御：必须在 vaultRoot 内（含分隔符边界，防止前缀劫持）
    if (!isInside(target, vaultRoot)) {
      throw new Error(`路径越界拒绝：${target}`);
    }
    await mkdir(fs, dirname(target));
    await writeFileText(fs, target, f.after);
    applied.push({ path: f.path, action: f.action });
  }
  return applied;
}

/**
 * 判断 child 是否在 parent 目录内（带分隔符边界）。
 */
export function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  return c.startsWith(p + '/');
}

/**
 * 真实行级 diff（基于 LCS）。
 * 返回数组：{ type: 'same'|'add'|'del'|'ctx', text }
 *  - same：相同行
 *  - add：新增行（after 独有）
 *  - del：删除行（before 独有）
 *  - ctx：上下文行（为相同行提供视觉缓冲，前导空行等）
 * UI 渲染：add → `+ `，del → `- `，same → `  `。
 */
export function diffLines(before, after, { context = 2 } = {}) {
  const b = String(before ?? '').split('\n');
  const a = String(after ?? '').split('\n');

  // LCS（动态规划，行级）
  const n = b.length, m = a.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = b[i] === a[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // 回溯生成操作序列
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (b[i] === a[j]) {
      ops.push({ type: 'same', text: b[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: b[i] });
      i++;
    } else {
      ops.push({ type: 'add', text: a[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ type: 'del', text: b[i] }); i++; }
  while (j < m) { ops.push({ type: 'add', text: a[j] }); j++; }

  return ops;
}

/**
 * 把 diffLines 的结果渲染成文本（用于纯文本预览/测试）。
 * 每行前缀：`+ ` 新增 / `- ` 删除 / `  ` 相同。
 */
export function diffText(before, after, opts) {
  const ops = diffLines(before, after, opts);
  if (!ops.some((o) => o.type !== 'same')) return '(无变化)';
  return ops.map((o) => (o.type === 'add' ? `+ ${o.text}` : o.type === 'del' ? `- ${o.text}` : `  ${o.text}`)).join('\n');
}

export default { applyProposal, diffLines, diffText, isInside };
