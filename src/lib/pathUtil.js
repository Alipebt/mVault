// pathUtil.js —— 轻量路径工具（浏览器兼容）
// 替代 node:path 在浏览器 WebView 中不可用的部分。
// 统一用 `/` 分隔；Windows 反斜杠 `\` 在输入时归一化为 `/`。

function toSep(p) {
  return String(p).replace(/\\/g, '/');
}

// 取目录部分：path.dirname('a/b/c.md') → 'a/b'
export function dirname(p) {
  p = toSep(p);
  if (!p) return '.';
  const idx = p.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return p.slice(0, idx);
}

// 取文件名：path.basename('a/b/c.md') → 'c.md'
export function basename(p) {
  p = toSep(p);
  if (!p) return '';
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

// 规范化路径（去 ./ 与重复斜杠；保留前导 / 与盘符前缀）
export function normalize(p) {
  p = toSep(p);
  if (!p) return '.';
  // Windows 盘符：D:/ 或 D:/
  const driveMatch = p.match(/^([A-Za-z]:)(\/|$)/);
  const drive = driveMatch ? driveMatch[1] : '';
  if (drive) p = p.slice(drive.length);
  const isAbs = p.startsWith('/');
  const parts = p.split('/').filter((s) => s && s !== '.');
  const out = [];
  for (const part of parts) {
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  const joined = out.join('/');
  const body = joined || (isAbs ? '' : '.');
  return (drive ? drive + '/' : isAbs ? '/' : '') + body;
}

// 拼接：path.join('a','b','c.md')
export function join(...parts) {
  return normalize(parts.filter((s) => s !== '' && s != null).join('/'));
}

// 绝对化：path.resolve(base, rel)
export function resolve(base, rel) {
  base = toSep(base || '/');
  rel = toSep(rel || '');
  if (rel.startsWith('/')) return normalize(rel);
  if (/^[A-Za-z]:\//.test(rel)) return normalize(rel);
  return normalize(join(base, rel));
}

export default { dirname, basename, normalize, join, resolve };
