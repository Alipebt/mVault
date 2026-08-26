// pwa/browser-shim.js —— 浏览器环境 shim 入口
// isomorphic-git 及其依赖可能在运行时访问 Node 的 Buffer；必须在应用模块
// 求值前把 browser Buffer polyfill 安装到 globalThis。
import { Buffer as BrowserBuffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BrowserBuffer;
}

// 兼容部分只从 window 查找全局对象的浏览器依赖。
if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined') {
  window.Buffer = BrowserBuffer;
}

// 在全局 shim 安装完成后再加载应用模块；静态 import 会先求值依赖，
// 无法保证 isomorphic-git 看到 Buffer。
await import('./app.js');
