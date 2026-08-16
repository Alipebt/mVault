// browser-shims/node-path-stub.js —— PWA 浏览器打包时替代 node:path
export function dirname(p) { const i = String(p).lastIndexOf('/'); return i <= 0 ? '.' : p.slice(0, i); }
export function resolve(b, r) { return b + '/' + (r || ''); }
export function join(...a) { return a.filter(Boolean).join('/'); }
export default { dirname, resolve, join };
