// entityDict.js —— 实体字典
// 已知实体 = 记忆/人物/ 目录下的文件名（去掉 .md）。
// 每个实体可带别名：
//   1. frontmatter `aliases`（新建人物表单写入，推荐）
//   2. 正文首段"亦称/又称/也叫 X、Y"（兼容真实记忆库：薛圣道.md 无 aliases 字段，
//      但首段写"亦称'薛哥'、'xsd'"）
// 纯本地、零 LLM：只扫描文件系统 + 读 frontmatter。

import { parseFrontmatter } from './markdown.js';
import { readDir, readFileText } from './fsCompat.js';

// 从正文首段提取别名：匹配 `亦称"X"、"Y"` / `又称 X、Y` / `也叫X` 等
export function extractAliasesFromIntro(body) {
  const aliases = new Set();
  // 取第一个非空非标题的段落（通常是有"亦称"的人物志引言）
  const firstPara = body.split(/\n{2,}/).map((p) => p.trim()).find((p) => p && !/^#{1,3}\s/.test(p));
  if (!firstPara) return [];
  // 匹配：亦称/又称/也叫/也叫作 后跟的引号或中文顿号分隔的别名，直到句号/分号
  const re = /(?:亦称|又称|也叫|也叫作|被称作|常写作)[：:：\s]*([^。；\n]+)/;
  const m = firstPara.match(re);
  if (m) {
    const chunk = m[1];
    // 提取引号内内容，或顿号/逗号分隔的中文词
    const quoted = chunk.matchAll(/["'“”‘’]([^"'“”‘’]{1,20})["'“”‘’]/g);
    let hasQuoted = false;
    for (const q of quoted) {
      hasQuoted = true;
      const a = q[1].trim();
      if (a) aliases.add(a);
    }
    if (!hasQuoted) {
      // 无引号 → 按顿号/逗号切分
      for (const part of chunk.split(/[、，,]/)) {
        const a = part.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
        if (a && !/[（）()<>《》]/.test(a)) aliases.add(a);
      }
    }
  }
  // 过滤掉明显不是别名的词
  const stop = new Set(['他', '她', '他们', '作者', '其', '本文', '日记', '人物']);
  return [...aliases].filter((a) => a.length <= 20 && !stop.has(a));
}

export async function loadEntityDict(fs, vaultRoot) {
  const dir = `${vaultRoot}/记忆/人物`;
  const entities = {};
  try {
    const names = await readDir(fs, dir);
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const pageName = name.replace(/\.md$/, '');
      if (pageName === '说明') continue;
      const aliases = new Set();
      try {
        const content = await readFileText(fs, `${dir}/${name}`);
        const { fm, body } = parseFrontmatter(content);
        if (Array.isArray(fm.aliases)) fm.aliases.forEach((a) => a && aliases.add(String(a).trim()));
        else if (typeof fm.aliases === 'string' && fm.aliases.trim()) aliases.add(fm.aliases.trim());
        // 兼容：正文首段"亦称…"提取别名
        for (const a of extractAliasesFromIntro(body)) aliases.add(a);
      } catch { /* 读不到就当无别名 */ }
      entities[pageName] = { name: pageName, aliases: [...aliases], file: `${dir}/${name}` };
    }
  } catch { /* 目录不存在则空 */ }
  return entities;
}

// 匹配正文：返回命中列表 [{name, alias, index}]
// 注意：同一段内同一别名多次出现只记一次（由调用方按 name 去重即可）
export function matchEntities(entities, text) {
  const hits = [];
  for (const ent of Object.values(entities)) {
    const keys = [ent.name, ...(ent.aliases || [])];
    for (const key of keys) {
      if (!key) continue;
      let idx = text.indexOf(key);
      while (idx !== -1) {
        hits.push({ name: ent.name, alias: key, index: idx });
        idx = text.indexOf(key, idx + key.length);
      }
    }
  }
  // 按位置排序
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

export default { loadEntityDict, matchEntities, extractAliasesFromIntro };
