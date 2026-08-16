// fsAdapter.js —— 文件系统适配层
// 提供统一的文件读写接口（readFile/writeFile/exists/listDir/mkdir）。
//   - Node 环境：node:fs/promises
//   - 浏览器（PWA/WebView）：@isomorphic-git/lightning-fs（基于 IndexedDB）
// 上层通过 fsCompat.js 调用，避免直接依赖本模块的具体实现。

import * as fsp from 'node:fs/promises';
import path from 'node:path';

// 平台探测：window + 无 require 全局 => 浏览器
export function isBrowser() {
  return typeof window !== 'undefined' && typeof require === 'undefined';
}

// ============ Node 实现 ============

async function nodeReadFile(filePath) {
  return fsp.readFile(filePath, 'utf8');
}
async function nodeWriteFile(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  return fsp.writeFile(filePath, data, 'utf8');
}
async function nodeExists(filePath) {
  try { await fsp.access(filePath); return true; } catch { return false; }
}
async function nodeListDir(dirPath) {
  return fsp.readdir(dirPath);
}
async function nodeMkdir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

// ============ 浏览器实现（lightning-fs / IndexedDB）============
// lightning-fs 的 PromisifiedFS 接口：readFile/writeFile/mkdir(非递归)/readdir/stat/unlink/rmdir
// 注意：mkdir 不支持 recursive，需要逐级创建。

let _lfs = null;
async function getLFS() {
  if (_lfs) return _lfs;
  const mod = await import('@isomorphic-git/lightning-fs');
  const LightningFS = mod.default || mod;
  _lfs = new LightningFS('memory-graph-vault');
  return _lfs;
}

// 递归创建目录（lightning-fs mkdir 无 recursive）
async function lfsMkdirp(fs, dirPath) {
  const parts = String(dirPath).split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { await fs.promises.mkdir(cur); } catch (e) {
      if (!String(e.message).includes('EEXIST')) throw e;
    }
  }
}

async function browserReadFile(filePath) {
  const fs = await getLFS();
  return fs.promises.readFile(filePath, 'utf8');
}
async function browserWriteFile(filePath, data) {
  const fs = await getLFS();
  await lfsMkdirp(fs, filePath.slice(0, filePath.lastIndexOf('/')));
  await fs.promises.writeFile(filePath, data);
}
async function browserExists(filePath) {
  const fs = await getLFS();
  try { await fs.promises.stat(filePath); return true; } catch { return false; }
}
async function browserListDir(dirPath) {
  const fs = await getLFS();
  return fs.promises.readdir(dirPath);
}
async function browserMkdir(dirPath) {
  const fs = await getLFS();
  await lfsMkdirp(fs, dirPath);
}

export const fsAdapter = {
  isBrowser,
  readFile: (p) => (isBrowser() ? browserReadFile(p) : nodeReadFile(p)),
  writeFile: (p, d) => (isBrowser() ? browserWriteFile(p, d) : nodeWriteFile(p, d)),
  exists: (p) => (isBrowser() ? browserExists(p) : nodeExists(p)),
  listDir: (p) => (isBrowser() ? browserListDir(p) : nodeListDir(p)),
  mkdir: (p) => (isBrowser() ? browserMkdir(p) : nodeMkdir(p)),
};

// 路径工具：把 vault 根目录 + 相对路径 拼成完整路径
export function joinPath(root, rel) {
  if (!rel) return root;
  if (root.endsWith('/')) return root + rel.replace(/^\/+/, '');
  return root + '/' + rel.replace(/^\/+/, '');
}

export default fsAdapter;
