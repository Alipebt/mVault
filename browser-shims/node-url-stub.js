// browser-shims/node-url-stub.js —— PWA 浏览器打包时替代 node:url
export function fileURLToPath() { throw new Error('node:url not available in browser'); }
export default { fileURLToPath };
