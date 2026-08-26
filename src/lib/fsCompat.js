// fsCompat.js —— fs 接口兼容层
//
// 上层代码（linkEngine / vaultIndex / entityDict / personFactory / applier）
// 习惯调用 fs.listDir / fs.readFile / fs.writeFile / fs.exists / fs.mkdir，
// 但实际传入的 fs 实现可能是：
//   1. 自定义瘦适配器（有 listDir，返回 Promise）——测试 fixture
//   2. node:fs/promises（只有 readdir，返回 Promise）
//   3. node:fs callback 风格（只有 readdir，回调式）
//   4. Capacitor 插件封装（有 listDir，返回 Promise）
//
// 本模块把上述实现统一为 Promise 风格的工具函数，避免
// "fs.listDir is not a function" 被空 catch 吞掉导致实体字典静默为空。

function isPromiseLike(x) {
  return x && typeof x.then === 'function';
}

// 调用 fs 方法：兼容 Promise 与 callback 两种风格。
function callAsync(fs, method, ...args) {
  const fn = fs[method];
  if (typeof fn !== 'function') {
    return Promise.reject(new Error(`fs 未提供 ${method} 方法（当前 fs 类型：${fs && fs.constructor && fs.constructor.name}）`));
  }
  let result;
  try {
    result = fn.call(fs, ...args);
  } catch (err) {
    // 同步抛错：通常是 node:fs callback 风格缺回调参数，走 callback 分支重试
    return callWithCallback(fs, method, args);
  }
  if (isPromiseLike(result)) return result;
  // 返回非 Promise 且有值：同步适配器直接返回结果
  if (result !== undefined) return Promise.resolve(result);
  // 返回 undefined：视为 callback 风格（node:fs 缺回调会抛错，走 catch 分支）
  return callWithCallback(fs, method, args);
}

function callWithCallback(fs, method, args) {
  return new Promise((resolve, reject) => {
    const fn = fs[method];
    try {
      fn.call(fs, ...args, (cbErr, ...res) => (cbErr ? reject(cbErr) : resolve(res.length > 1 ? res : res[0])));
    } catch (e) {
      reject(e);
    }
  });
}

// 读取目录：兼容 listDir（自定义适配器）与 readdir（node:fs）。
export function readDir(fs, dir) {
  const method = typeof fs.listDir === 'function' ? 'listDir' : 'readdir';
  return callAsync(fs, method, dir);
}

// 读文本文件。
export function readFileText(fs, filePath) {
  return callAsync(fs, 'readFile', filePath, 'utf8');
}

// 写文本文件。
export function writeFileText(fs, filePath, data) {
  return callAsync(fs, 'writeFile', filePath, data, 'utf8');
}

// 判断文件/目录是否存在：优先 fs.exists（瘦适配器），否则 stat / access。
export async function exists(fs, p) {
  if (typeof fs.exists === 'function') {
    const r = fs.exists.call(fs, p);
    if (isPromiseLike(r)) return r;
    return new Promise((resolve) => fs.exists.call(fs, p, resolve));
  }
  try {
    await callAsync(fs, 'stat', p);
    return true;
  } catch {
    return false;
  }
}

// 创建目录（recursive）。
export function mkdir(fs, dir) {
  if (typeof fs.mkdir !== 'function') {
    return Promise.reject(new Error(`fs 未提供 mkdir 方法`));
  }
  return callAsync(fs, 'mkdir', dir, { recursive: true });
}

export default { readDir, readFileText, writeFileText, exists, mkdir };
