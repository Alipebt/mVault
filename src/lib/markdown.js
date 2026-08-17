// markdown.js —— Markdown 与 frontmatter 解析/序列化工具
//
// 对齐 CLAUDE.md §2.2 的 frontmatter 规范：
//   - type / date / created 等"枚举/日期"字段不加引号
//   - tags / aliases 数组：`[item, item]`，元素不加引号
//   - 仅当字段值包含 YAML 特殊字符（`:` `#` `[` `]` `"` 等）时才加引号
// 目标：让 App 改写后的文件与真实记忆库格式一致，减少 diff 噪音。

// 判断字符串是否需要加引号（含 YAML 特殊字符）
function needsQuote(val) {
  return /[:#\[\]{}&*!|>'"%@`,?]/.test(val) || /^[\s\-?]/.test(val) || val === '' || val.includes('  ');
}

export function quoteYamlValue(val) {
  const s = String(val);
  if (s === 'true' || s === 'false' || /^-?\d+(\.\d+)?$/.test(s)) return s;
  // 中文或 YAML 特殊字符 → 加引号（与真实记忆库 frontmatter 风格一致，如 title/summary）
  if (/[一-鿿]/.test(s) || needsQuote(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return s;
}

// 解析 frontmatter（--- 包裹的 YAML 子集）
export function parseFrontmatter(text) {
  const fm = {};
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return { fm, body: text, raw: null };
  const raw = m[1];
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // 去掉引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // 简单列表 [a, b] → 数组
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    fm[key] = val;
  }
  return { fm, body: text.slice(m[0].length), raw };
}

export function serializeFrontmatter(fm) {
  const keys = Object.keys(fm || {});
  // 无字段时返回空字符串（避免生成空的 ---\n---，污染无 frontmatter 的文件如 目录.md）
  if (keys.length === 0) return '';
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      // 数组元素（tags/aliases）默认不加引号，对齐真实库 `tags: [人物, 大学同学]` 格式
      const items = v.map((x) => String(x ?? '').trim()).filter((s) => s !== '');
      lines.push(items.length ? `${k}: [${items.join(', ')}]` : `${k}: []`);
    } else if (typeof v === 'string') {
      lines.push(`${k}: ${quoteYamlValue(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// 解析日记：返回 { fm, date, blocks: [{id, text}] }
// 按空行分段；段落末尾的"同行后缀块 ID"（`段落文本 ^id`）会被剥离并记录为 id。
export function parseDiary(content) {
  const { fm, body } = parseFrontmatter(content);
  const blocks = [];
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  for (const p of paragraphs) {
    // 跳过标题行（# 或 ##）与独立成行的 ^id
    if (/^#{1,3}\s/.test(p)) continue;
    if (/^\^[a-z][a-z0-9-]*\s*$/m.test(p)) continue;
    // 提取"同行后缀"块 ID：`正文 ^id`
    const inlineId = p.match(/\s+\^([a-z][a-z0-9-]*)\s*$/);
    if (inlineId) {
      const text = p.slice(0, inlineId.index).trim();
      if (text) blocks.push({ id: inlineId[1], text });
      continue;
    }
    if (p.trim()) blocks.push({ id: null, text: p.trim() });
  }
  return { fm, date: fm.date, blocks };
}

// 从日记文本提取某个日期的所有段落（含行尾块 ID）
export function findDateSections(content, dateStr) {
  const { body } = parseFrontmatter(content);
  const sections = [];
  const lines = body.split('\n');
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/);
    if (m) {
      current = { date: m[1], paras: [] };
      sections.push(current);
    } else if (current) {
      if (line.trim() && !/^#/.test(line)) current.paras.push(line.trim());
    }
  }
  return sections;
}

// 替换日记中某日期节的内容。
// content：整个日记文件内容；date：YYYY-MM-DD；newBody：该日期的新正文（多段以空行分隔，不含标题行）。
// 返回新文件内容；若该日期节不存在则返回 null。
// 保留节内已有的块 ID 后缀（^xxx）：新正文段落若不带块 ID，会尝试匹配保留原 ID。
export function replaceDateSection(content, date, newBody) {
  const { body } = parseFrontmatter(content);
  const lines = body.split('\n');
  // 找 ## date 标题行
  const headRe = new RegExp(`^##\\s+${date}\\s*$`);
  const headIdx = lines.findIndex((l) => headRe.test(l.trim()));
  if (headIdx === -1) return null;
  // 找节结束（下一个 ## 标题或文件末尾）
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  // 收集该节原有的块 ID（段落后缀 ^xxx），用于匹配保留
  const oldIds = [];
  for (let i = headIdx + 1; i < endIdx; i++) {
    const m = lines[i].match(/\s+\^([a-z][a-z0-9-]*)\s*$/);
    if (m) oldIds.push(m[1]);
  }
  // 新段落：把用户输入的正文切成段落，空行分隔
  const paras = String(newBody).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const newSection = paras.length
    ? paras.map((p, i) => {
        // 若段落本身没带块 ID，且还有可用旧 ID，则补上（保持回忆嵌入有效）
        if (!/\s+\^[a-z][a-z0-9-]*\s*$/.test(p) && oldIds.length > 0 && i < oldIds.length) {
          return `${p} ^${oldIds[i]}`;
        }
        return p;
      }).join('\n\n')
    : '';
  // 重新组装：标题 + 空行 + 新内容 + 后续
  const out = [...lines.slice(0, headIdx + 1)];
  if (newSection) {
    out.push('');
    out.push(...newSection.split('\n'));
  }
  out.push(...lines.slice(endIdx));
  // 压缩连续空行
  const result = [];
  let prevBlank = false;
  for (const l of out) {
    const blank = l.trim() === '';
    if (blank && prevBlank) continue;
    result.push(l);
    prevBlank = blank;
  }
  return result.join('\n');
}

// 把 frontmatter 的指定字段改为新值，其余行逐字节保留；返回 { fmText, body }。
// 目的：改写已有页面（日记/人物/回忆）时，只产生 `updated` 一行 diff，
// 避免 serializeFrontmatter 整体重排导致的 diff 噪音。
// 若文件无 frontmatter，fmText 为空串，body 为原文。
export function setFrontmatterField(content, field, value) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return { fmText: '', body: content };
  let raw = m[1];
  const re = new RegExp(`^(${field}):.*$`, 'm');
  if (re.test(raw)) raw = raw.replace(re, `${field}: ${quoteYamlValue(value)}`);
  else raw = raw + `\n${field}: ${quoteYamlValue(value)}`;
  return { fmText: `---\n${raw}\n---\n`, body: content.slice(m[0].length) };
}

// 兼容别名：只把 `updated` 改为 date（内部用 setFrontmatterField 实现）
export function bumpUpdated(content, date) {
  const { fmText, body } = setFrontmatterField(content, 'updated', date);
  return fmText ? fmText + body : content;
}

export default { parseFrontmatter, serializeFrontmatter, quoteYamlValue, parseDiary, findDateSections, setFrontmatterField, bumpUpdated, replaceDateSection };
