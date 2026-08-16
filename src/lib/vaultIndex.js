// vaultIndex.js —— 记忆库索引层
// 扫描 记忆/ 全部页面，产出结构化索引（节点 + 边 + 日记条目 + 人物 + 回忆）。
// 这是"浏览"与图谱 A1（力导向图）共享的数据基础。
// 纯本地、零 LLM：只读文件系统 + 正则解析 [[链接]] 与 ![[嵌入]]。

import { parseFrontmatter } from './markdown.js';
import { extractAliasesFromIntro } from './entityDict.js';
import { readDir, readFileText } from './fsCompat.js';

// 提取所有 [[链接]] 与 ![[嵌入]] 的目标名（去重）
function extractLinks(text) {
  const links = new Set();
  const re = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    links.add(m[1].trim());
  }
  return [...links];
}

// 提取 ![[year#^blockId]] 嵌入（回忆页）
function extractEmbeds(text) {
  const embeds = [];
  const re = /!\[\[(\d{4})#\^([a-z][a-z0-9-]*)\]\]/g;
  let m;
  while ((m = re.exec(text))) embeds.push({ year: m[1], blockId: m[2] });
  return embeds;
}

// 从日记正文提取 [## YYYY-MM-DD, 段落...]
// 注意：剥离段落行尾的块 ID（`正文 ^id`），避免时间线显示垃圾行。
function parseDiaryEntries(body) {
  const entries = [];
  const lines = body.split('\n');
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (m) {
      if (cur) entries.push(cur);
      cur = { date: m[1], paras: [] };
    } else if (cur) {
      const t = line.trim();
      if (t && !/^#{1,2}\s/.test(t) && !/^!?\[\[/.test(t)) {
        // 剥离行尾块 ID（`正文 ^id` 同行后缀）
        const noId = t.replace(/\s+\^([a-z][a-z0-9-]*)\s*$/, '');
        // 独立成行的 ^id 直接跳过
        if (/^\^[a-z][a-z0-9-]*$/.test(noId)) continue;
        if (noId.trim()) cur.paras.push(noId.trim());
      }
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

// 扫描整个 记忆/ 目录
export async function indexVault(fs, vaultRoot) {
  const root = `${vaultRoot}/记忆`;
  const index = {
    nodes: [],        // {id, title, type, path, tags, summary, year, updated}
    edges: [],        // {source, target, kind: 'link'|'embed'}
    diary: [],        // {year, date, paras, file}
    people: [],       // {name, aliases, path, tags, summary, file}
    recollections: [],// {stage, file, date, blockId}
    byPath: {},       // path -> node id
  };

  const subdirs = ['日记', '人物', '回忆'];
  for (const sub of subdirs) {
    const dir = `${root}/${sub}`;
    let files = [];
    try { files = await readDir(fs, dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      if (f === '说明.md') continue; // 目录说明文件，不入索引
      const filePath = `${dir}/${f}`;
      let content;
      try { content = await readFileText(fs, filePath); } catch { continue; }
      const { fm, body } = parseFrontmatter(content);
      const title = fm.title || f.replace(/\.md$/, '');
      // id 用文件名（Obsidian 链接基于文件名），title 用 frontmatter 标题
      const id = f.replace(/\.md$/, '');
      const links = extractLinks(content);
      const node = {
        id, title, type: fm.type || 'page', path: `记忆/${sub}/${f}`,
        tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
        summary: fm.summary || '', year: fm.date || null, updated: fm.updated || null,
      };
      index.nodes.push(node);
      index.byPath[`记忆/${sub}/${f}`] = id;

      if (sub === '日记') {
        const entries = parseDiaryEntries(body);
        for (const e of entries) index.diary.push({ ...e, year: fm.date || e.date.slice(0, 4), file: `记忆/${sub}/${f}` });
      } else if (sub === '人物') {
        const aliases = new Set();
        if (Array.isArray(fm.aliases)) fm.aliases.forEach((a) => a && aliases.add(String(a).trim()));
        else if (typeof fm.aliases === 'string' && fm.aliases.trim()) aliases.add(fm.aliases.trim());
        for (const a of extractAliasesFromIntro(body)) aliases.add(a);
        index.people.push({ name: id, aliases: [...aliases], path: `记忆/${sub}/${f}`, tags: node.tags, summary: fm.summary || '' });
      } else if (sub === '回忆') {
        const embeds = extractEmbeds(body);
        for (const emb of embeds) {
          index.recollections.push({ stage: id, file: `记忆/${sub}/${f}`, date: emb.year, blockId: emb.blockId });
        }
      }

      // 出站链接边（目标先记录为 id，最后统一 resolve）
      for (const link of links) {
        index.edges.push({ source: id, target: link, kind: 'link' });
      }
    }
  }

  // 去重边
  const seen = new Set();
  index.edges = index.edges.filter((e) => {
    const k = `${e.source}|${e.target}|${e.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 排序：日记按日期
  index.diary.sort((a, b) => (a.date < b.date ? -1 : 1));
  return index;
}

export default { indexVault };
