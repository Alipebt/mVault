// build-pwa.mjs —— PWA 生产打包
// 用 esbuild 把 pwa/app.js + src/lib/* + isomorphic-git + lightning-fs 打成单文件浏览器 bundle。
// 产物：dist-pwa/（index.html + bundle + manifest + style）
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = __dirname;
const OUT = path.resolve(APP_ROOT, 'dist-pwa');

// 确保输出目录存在（不强制删除整个目录——挂载目录可能不允许 rm）
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// 复制静态资源（覆盖同名文件）。sw.js 与 PWA 源码同目录，确保部署时
// Service Worker 不会继续引用旧版本缓存。
for (const f of ['index.html', 'style.css', 'manifest.json', 'sw.js']) {
  fs.copyFileSync(path.join(APP_ROOT, 'pwa', f), path.join(OUT, f));
}

// 打包 JS（单文件 bundle）
// 入口用 browser-shim.js：先注入 Buffer polyfill，再动态加载 app.js，
// 确保 isomorphic-git 的模块求值阶段也能访问全局 Buffer。
await build({
  entryPoints: [path.resolve(APP_ROOT, 'pwa/browser-shim.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022', 'chrome100', 'safari15'],
  outfile: path.join(OUT, 'app.bundle.js'),
  sourcemap: false,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // 浏览器环境无 node: 模块，映射到存根（PWA 用 lightning-fs，不走 node 分支）
  alias: {
    'node:fs': path.join(APP_ROOT, 'browser-shims/node-fs-stub.js'),
    'node:fs/promises': path.join(APP_ROOT, 'browser-shims/node-fs-promises-stub.js'),
    'node:path': path.join(APP_ROOT, 'browser-shims/node-path-stub.js'),
    'node:url': path.join(APP_ROOT, 'browser-shims/node-url-stub.js'),
  },
  // lightning-fs 在浏览器用 IndexedDB；isomorphic-git http 走 fetch
  external: [],
});

// 修正 index.html 引用为带版本号的 bundle，避免旧 Service Worker / 浏览器缓存
// 继续返回没有 Buffer shim 的旧 bundle。
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace(/app\.bundle\.js(?:\?v=\d+)?/, 'app.bundle.js?v=6');
html = html.replace(/sw\.js(?:\?v=\d+)?/, 'sw.js?v=6');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

const size = fs.statSync(path.join(OUT, 'app.bundle.js')).size / 1024;
console.log(`\nPWA 打包完成: dist-pwa/ (bundle ${size.toFixed(0)} KB)`);
console.log('部署：把 dist-pwa/ 目录上传到任意静态托管（GitHub Pages / Netlify / Vercel）。');
