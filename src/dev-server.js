// dev-server.js —— 开发用本地服务
// 在 Node 环境模拟 Capacitor 插件 API，把 vault 根目录绑定到真实记忆库。
// 这样可以在电脑浏览器里预览 app，方便开发调试。
// 注意：这是开发工具，不是生产架构。手机上跑的是 Capacitor 原生壳。

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(__dirname, '../www');
import { initVaultConfig, getVault, setVault } from './lib/vaultConfig.js';
let VAULT = await initVaultConfig(process.env.VAULT_ROOT);

// Node 文件系统实现（瘦适配器：供链接引擎/索引使用）
const nodeFs = {
  readFile: (p) => fs.readFile(p, 'utf8'),
  writeFile: (p, d) => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, d, 'utf8')),
  exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
  listDir: (p) => fs.readdir(p),
  mkdir: (p) => fs.mkdir(p, { recursive: true }),
};

import { createProposal } from './lib/linkEngine.js';
import { applyProposal, diffText } from './lib/applier.js';
import { createPersonPage } from './lib/personFactory.js';
import { loadEntityDict } from './lib/entityDict.js';
import gitClient from './lib/gitClient.js';
import { indexVault } from './lib/vaultIndex.js';
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    // 静态资源
    if (req.method === 'GET' && !pathname.startsWith('/api')) {
      let file = path.join(WWW, pathname === '/' ? 'index.html' : pathname);
      const ext = path.extname(file);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
      try {
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        json(res, 404, { error: 'not found' });
      }
      return;
    }

    // API：POST /api/quick-add  —— 今日速记生成提案
    if (req.method === 'POST' && pathname === '/api/quick-add') {
      const body = JSON.parse(await readBody(req));
      const proposal = await createProposal(nodeFs, getVault(), { text: body.text, date: body.date });
      json(res, 200, { proposal: serializeProposal(proposal) });
      return;
    }

    // API：POST /api/apply  —— 应用提案（确认后）
    if (req.method === 'POST' && pathname === '/api/apply') {
      const body = JSON.parse(await readBody(req));
      // 安全校验：所有落盘路径必须以 VAULT 开头（带分隔符边界，防止前缀劫持）
      const vaultNow = getVault();
      for (const f of body.proposal.files) {
        const target = f.fullPath || f.path;
        if (!isInsideVault(target, vaultNow)) {
          json(res, 400, { error: `路径越界拒绝：${target}` });
          return;
        }
      }
      const applied = await applyProposal(nodeFs, vaultNow, body.proposal);
      json(res, 200, { applied: applied.length });
      return;
    }

    // API：POST /api/create-person  —— 新建人物
    if (req.method === 'POST' && pathname === '/api/create-person') {
      const body = JSON.parse(await readBody(req));
      const result = await createPersonPage(nodeFs, getVault(), body);
      json(res, 200, result);
      return;
    }

    // API：GET /api/entities  —— 当前实体字典
    if (req.method === 'GET' && pathname === '/api/entities') {
      const entities = await loadEntityDict(nodeFs, getVault());
      json(res, 200, { entities: Object.keys(entities).map((k) => ({ name: entities[k].name, aliases: entities[k].aliases })) });
      return;
    }

    // API：GET /api/vault  —— 当前记忆库路径
    if (req.method === 'GET' && pathname === '/api/vault') {
      json(res, 200, { vault: getVault() });
      return;
    }

    // API：POST /api/vault  —— 设置记忆库路径
    if (req.method === 'POST' && pathname === '/api/vault') {
      const body = JSON.parse(await readBody(req));
      try {
        const p = await setVault(body.path);
        json(res, 200, { vault: p });
      } catch (e) {
        json(res, 400, { error: e.message });
      }
      return;
    }

    // API：POST /api/editor-preview  —— 编辑预览（返回 diff，不落盘）
    if (req.method === 'POST' && pathname === '/api/editor-preview') {
      const body = JSON.parse(await readBody(req));
      const vaultNow = getVault();
      const rel = (body.path || '').replace(/^\/+/, '');
      const full = `${vaultNow}/${rel}`;
      if (!(await nodeFs.exists(full))) { json(res, 404, { error: '页面不存在' }); return; }
      const before = await nodeFs.readFile(full);
      const after = body.content;
      json(res, 200, { path: rel, fullPath: full, diff: diffText(before, after), before, after });
      return;
    }

    // API：POST /api/editor-save  —— 保存编辑（校验路径 + 落盘）
    if (req.method === 'POST' && pathname === '/api/editor-save') {
      const body = JSON.parse(await readBody(req));
      const vaultNow = getVault();
      const rel = (body.path || '').replace(/^\/+/, '');
      const full = `${vaultNow}/${rel}`;
      if (!isInsideVault(full, vaultNow)) { json(res, 400, { error: '路径越界拒绝' }); return; }
      if (!(await nodeFs.exists(full))) { json(res, 404, { error: '页面不存在' }); return; }
      await nodeFs.writeFile(full, body.content);
      json(res, 200, { saved: rel });
      return;
    }

    // API：GET /api/git-status  —— git 状态
    if (req.method === 'GET' && pathname === '/api/git-status') {
      // git 需要完整 fs API，用 node:fs（gitClient 内部对瘦适配器自动降级到 node:fs）
      const status = await gitClient.status(nodeFs, getVault());
      json(res, 200, { status });
      return;
    }

    // API：POST /api/git-discard  —— 撤销指定文件的未提交改动（恢复到 HEAD）
    if (req.method === 'POST' && pathname === '/api/git-discard') {
      const body = JSON.parse(await readBody(req));
      const files = Array.isArray(body.files) ? body.files : [body.files];
      const results = await gitClient.discard(nodeFs, getVault(), files);
      json(res, 200, { results });
      return;
    }

    // API：GET /api/index  —— 记忆库索引（浏览 + 图谱共用）
    if (req.method === 'GET' && pathname === '/api/index') {
      const index = await indexVault(nodeFs, getVault());
      json(res, 200, { index });
      return;
    }

    // API：GET /api/page?path=记忆/日记/2024.md  —— 单页内容
    if (req.method === 'GET' && pathname === '/api/page') {
      const rel = url.searchParams.get('path') || '';
      const safe = rel.replace(/^\//, '');
      const full = `${getVault()}/${safe}`;
      if (!(await nodeFs.exists(full))) { json(res, 404, { error: 'page not found' }); return; }
      const content = await nodeFs.readFile(full);
      json(res, 200, { path: safe, content });
      return;
    }

    json(res, 404, { error: `no route ${pathname}` });
  } catch (e) {
    json(res, 500, { error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

// 判断 target 是否在 vault 目录内（带分隔符边界）
function isInsideVault(target, vault) {
  const t = path.resolve(target);
  const v = path.resolve(vault);
  return t === v || t.startsWith(v + path.sep);
}

function serializeProposal(p) {
  const vaultNow = getVault().replace(/[\\/]+$/, '');
  return {
    files: p.files.map((f) => ({
      fullPath: f.path,                    // 绝对路径，用于落盘
      path: f.path.replace(vaultNow, ''), // 相对路径，用于显示
      action: f.action,
      diff: diffText(f.before, f.after),
      after: f.after,
    })),
    entitiesHit: p.entitiesHit,
    newCandidates: p.newCandidates,
    recollections: p.recollections.map((r) => ({ stage: r.stage.file, blockId: r.blockId, dateStr: r.dateStr })),
    generatedLinks: p.generatedLinks,
  };
}

const PORT = process.env.PORT || 3210;

server.listen(PORT, () => {
  console.log(`dev-server 运行中： http://localhost:${PORT}`);
  console.log(`vault: ${getVault()}`);
});
