// pwa/browser-shim.js —— 浏览器环境 shim 入口
// isomorphic-git 内部使用 Node 的 Buffer，浏览器没有该全局对象。
// 这里在应用加载前注入 Buffer polyfill（buffer 包，isomorphic-git 的传递依赖）。
import { Buffer } from 'buffer';

// 注入全局 Buffer（浏览器环境）
if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined') {
  window.Buffer = Buffer;
}
globalThis.Buffer = Buffer;

// 加载实际应用
import './app.js';
