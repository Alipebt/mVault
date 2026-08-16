// linkEngine.js —— 零 LLM 自动链接引擎
// 输入：vault 根目录 + 速记正文 + 日期
// 输出：变更提案（proposal），含要创建/修改的文件及 diff 预览
// 不直接写盘 —— 由调用方预览确认后 apply。
//
// 对齐 CLAUDE.md §3.1-3.3 / §4.1：
//   - 日记段落之间空行分隔（独立块）；被引用的段落末尾"同行后缀"块 ID `^阶段-特征`
//   - 块 ID：英文小写 + 连字符，特征词 = 命中人物拼音 / 段首关键词拼音，全库唯一
//   - 回忆页：`## [[YYYY#YYYY-MM-DD|日期]]` + `![[年份#^块ID]]` 块嵌入，同日期节合并
//   - 人物志：记忆线索追加 `- [[YYYY#YYYY-MM-DD|YYYY-MM-DD]]：摘要`，去重
//   - 只改 `updated`，不整体重排 frontmatter，最小化 diff

import { parseFrontmatter, serializeFrontmatter, parseDiary, setFrontmatterField } from './markdown.js';
import { loadEntityDict, matchEntities } from './entityDict.js';
import { toPinyin } from './slugify.js';
import { readDir, readFileText, exists } from './fsCompat.js';

// 阶段关键词 → 阶段英文/文件名
// 注意：考研/备考/读研 归 college（真实库"大学"回忆含考研阶段）
const STAGE_KEYWORDS = [
  { stage: 'preschool', file: '学龄前', words: ['学龄前', '幼儿园前', '我记得很小的时候', '很小的时候', '两三岁', '三四岁', '四五岁', '婴', '婴儿'] },
  { stage: 'primary', file: '小学', words: ['上小学', '小学时候', '小学时', '小学毕业'] },
  { stage: 'middle', file: '初中', words: ['上初中', '初中时候', '初中时', '初中毕业', '初一', '初二', '初三'] },
  { stage: 'high', file: '高中', words: ['上高中', '高中时候', '高中时', '高三', '高考', '高二', '高一', '高中毕业'] },
  { stage: 'college', file: '大学', words: ['大学', '本科', '大一', '大二', '大三', '大四', '读研', '研究生', '考研', '备考', '研一', '研二', '研三', '宿舍', '舍友'] },
];

function detectStage(text) {
  for (const s of STAGE_KEYWORDS) {
    for (const w of s.words) {
      if (text.includes(w)) return { stage: s.stage, file: s.file, hitWord: w };
    }
  }
  return null; // 未命中 → 非回忆，不归类
}

// 从人名/段落生成块 ID 特征词（英文小写+连字符，最多 24 字符）
function slugify(str, maxLen = 24) {
  const s = toPinyin(str);
  if (!s) return 'entry';
  return s.slice(0, maxLen).replace(/-+$/, '');
}

// 生成块 ID：^阶段-特征（全库查重）
function makeBlockId(stage, hint, existingIds) {
  let feat = slugify(hint || 'entry');
  if (!feat || feat === 'entry') feat = 'entry';
  let id = `${stage}-${feat}`;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${stage}-${feat}-${n}`;
    n++;
  }
  existingIds.add(id);
  return id;
}

// 已有块 ID 收集（从全部日记页）
async function collectExistingBlockIds(fs, vaultRoot, year) {
  const ids = new Set();
  const years = new Set([year]);
  try {
    const diaryDir = `${vaultRoot}/记忆/日记`;
    for (const f of await readDir(fs, diaryDir)) {
      if (f.endsWith('.md') && /^\d{4}\.md$/.test(f)) years.add(f.slice(0, 4));
    }
  } catch { /* 忽略 */ }
  for (const y of years) {
    try {
      const content = await readFileText(fs, `${vaultRoot}/记忆/日记/${y}.md`);
      const re = /\^([a-z][a-z0-9-]*)/g;
      let m;
      while ((m = re.exec(content))) ids.add(m[1]);
    } catch { /* 忽略 */ }
  }
  return ids;
}

// 生成人物志一行：- [[YYYY#YYYY-MM-DD|YYYY-MM-DD]]：<段落开头>
function makePersonLine(dateStr, para) {
  const year = dateStr.slice(0, 4);
  const preview = para.replace(/\[\[.*?\]\]/g, '').replace(/\^[a-z][a-z0-9-]*\s*$/g, '').replace(/\s+/g, ' ').trim();
  const snippet = preview.length > 40 ? preview.slice(0, 40) + '…' : preview;
  return `- [[${year}#${dateStr}|${dateStr}]]：${snippet}`;
}

// 在日记正文中把段落追加到指定日期节；若节不存在则新建节。
// 返回 { body, appendedParas: [{text, id}] }。id 为 null 表示无块 ID。
function appendParasToDate(body, date, parasWithIds) {
  const lines = body.split('\n');
  // 找 ## date 标题行
  const headRe = new RegExp(`^##\\s+${date}\\s*$`);
  const headIdx = lines.findIndex((l) => headRe.test(l.trim()));
  if (headIdx === -1) {
    // 新建节：追加到 body 末尾（标题前必须有空行，Obsidian 才能识别为标题）
    let seg = `\n\n## ${date}\n\n`;
    seg += parasWithIds.map((p) => (p.id ? `${p.text} ^${p.id}` : p.text)).join('\n\n') + '\n';
    return { body: body.replace(/\s+$/, '') + seg, appendedParas: parasWithIds };
  }
  // 已有节：找到该节内容结束位置（下一个 ## 标题 或 文件末尾）
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  // 节内已有内容（去尾部空行，保留原样；原内容必须完整保留！）
  let tail = lines.slice(headIdx + 1, endIdx);
  while (tail.length && tail[tail.length - 1].trim() === '') tail = tail.slice(0, -1);
  const block = parasWithIds.map((p) => (p.id ? `${p.text} ^${p.id}` : p.text)).join('\n\n');
  const newLines = [...lines.slice(0, headIdx + 1)];
  // 原节内容（必须完整保留）
  if (tail.length) {
    newLines.push(...tail);
    newLines.push('');
  } else {
    newLines.push(''); // 空节：标题后保留空行
  }
  newLines.push(...block.split('\n'));
  // 若节后还有内容（下一个标题），确保空行分隔
  if (endIdx < lines.length) newLines.push('');
  newLines.push(...lines.slice(endIdx));
  // 压缩连续空行到最多一个
  const out = [];
  let prevBlank = false;
  for (const l of newLines) {
    const blank = l.trim() === '';
    if (blank && prevBlank) continue;
    out.push(l);
    prevBlank = blank;
  }
  return { body: out.join('\n'), appendedParas: parasWithIds };
}

// 在回忆页正文中把嵌入追加到指定日期节；若节不存在则新建节。返回新正文。
function appendEmbedToDate(body, year, date, blockId) {
  const heading = `## [[${year}#${date}|${date}]]`;
  const embed = `![[${year}#^${blockId}]]`;
  const lines = body.split('\n');
  const headIdx = lines.findIndex((l) => l.trim() === heading);
  if (headIdx === -1) {
    return body.replace(/\s+$/, '') + `\n\n${heading}\n\n${embed}\n`;
  }
  // 已有节：末尾追加嵌入
  let endIdx = lines.length;
  for (let i = headIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { endIdx = i; break; }
  }
  const newLines = [...lines.slice(0, endIdx)];
  newLines.push(embed);
  // 若节后还有内容（下一个标题），确保空行分隔
  if (endIdx < lines.length) newLines.push('');
  newLines.push(...lines.slice(endIdx));
  // 压缩连续空行
  const out = [];
  let prevBlank = false;
  for (const l of newLines) {
    const blank = l.trim() === '';
    if (blank && prevBlank) continue;
    out.push(l);
    prevBlank = blank;
  }
  return out.join('\n');
}

// 主函数：生成变更提案
export async function createProposal(fs, vaultRoot, { text, date }) {
  if (!date) {
    const now = new Date();
    date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const year = date.slice(0, 4);
  const diaryPath = `${vaultRoot}/记忆/日记/${year}.md`;

  // 1. 读日记当前内容
  let diaryContent = '';
  let diaryFm = null;
  let diaryBody = '';
  if (await exists(fs, diaryPath)) {
    diaryContent = await readFileText(fs, diaryPath);
    ({ fm: diaryFm, body: diaryBody } = parseFrontmatter(diaryContent));
  } else {
    diaryFm = {
      title: `${year}年日记`, type: 'journal', date: year, raw_date: `${year}年`,
      created: date, updated: date, tags: ['日记'], source: `数据/文字/${year}年.docx`, summary: `${year}年日记`,
    };
  }

  const existingIds = await collectExistingBlockIds(fs, vaultRoot, year);

  // 2. 载入实体字典
  const entities = await loadEntityDict(fs, vaultRoot);

  // 3. 拆分段落
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  // 4. 生成提案
  const proposal = {
    files: [],
    entitiesHit: [],
    newCandidates: [],
    recollections: [],
    generatedLinks: [],
  };

  // 处理每个段落
  const parasWithIds = []; // {text, id}
  for (const para of paragraphs) {
    // 实体匹配
    const hits = matchEntities(entities, para);
    const hitNames = [...new Set(hits.map((h) => h.name))];
    if (hitNames.length) for (const n of hitNames) if (!proposal.entitiesHit.includes(n)) proposal.entitiesHit.push(n);
    proposal.generatedLinks.push({ para: para.slice(0, 30), names: hitNames });

    // 疑似新实体：启发式提取
    const newCand = extractCandidateNames(para, entities, hitNames);
    for (const c of newCand) proposal.newCandidates.push({ name: c, para: para.slice(0, 30) });

    // 回忆归类 + 块 ID
    const stage = detectStage(para);
    let id = null;
    if (stage) {
      // 特征词优先级：命中实体名 > 命中的阶段关键词 > 段落前部关键词
      const hint = hitNames[0] || stage.hitWord || extractHintFromPara(para);
      id = makeBlockId(stage.stage, hint, existingIds);
      proposal.recollections.push({ stage, file: stage.file, blockId: id, dateStr: date, para });
    }
    parasWithIds.push({ text: para, id });
  }

  // 5. 构造新日记正文 + 文件
  const { body: newDiaryBody, appendedParas } = appendParasToDate(diaryBody, date, parasWithIds);
  let newDiaryContent;
  if (diaryFm) {
    const { fmText, body } = setFrontmatterField(diaryContent, 'updated', date);
    newDiaryContent = fmText ? fmText + newDiaryBody : serializeFrontmatter(diaryFm) + '\n' + newDiaryBody;
  } else {
    newDiaryContent = serializeFrontmatter(diaryFm) + '\n' + newDiaryBody;
  }
  proposal.files.push({ path: diaryPath, action: diaryContent ? 'update' : 'create', before: diaryContent || '', after: newDiaryContent });

  // 6. 更新人物志（命中实体 → 记忆线索加行，去重）
  for (const name of proposal.entitiesHit) {
    if (!entities[name]) continue;
    const personPath = entities[name].file;
    let personContent;
    try { personContent = await readFileText(fs, personPath); } catch { continue; }
    const { fm: personFm, body: personBody } = parseFrontmatter(personContent);
    // 已有该日期的线索行？去重
    const dateMark = `[[${year}#${date}|${date}]]`;
    if (personBody.includes(dateMark)) continue;
    const para = paragraphs.find((p) => p.includes(name)) || text;
    const line = makePersonLine(date, para);
    const lines = personBody.split('\n');
    // 找"记忆线索"区的末尾：## 记忆线索 到下一个 ## 之间
    const clueIdx = lines.findIndex((l) => l.trim().startsWith('## 记忆线索'));
    let newLines;
    if (clueIdx >= 0) {
      // 在记忆线索区内追加（区末 = 下一个 ## 标题或文件末尾）
      let endIdx = lines.length;
      for (let i = clueIdx + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) { endIdx = i; break; }
      }
      // 去掉区末尾多余空行
      while (endIdx > clueIdx + 1 && lines[endIdx - 1].trim() === '') endIdx--;
      newLines = [...lines.slice(0, endIdx), '', line, ...lines.slice(endIdx)];
    } else {
      newLines = [...lines, '', '## 记忆线索', '', line];
    }
    const newBody = newLines.join('\n').replace(/\n{3,}/g, '\n\n');
    const { fmText } = setFrontmatterField(personContent, 'updated', date);
    const newContent = fmText ? fmText + newBody : serializeFrontmatter(personFm) + '\n' + newBody;
    proposal.files.push({ path: personPath, action: 'update', before: personContent, after: newContent });
  }

  // 7. 回忆归类 → 阶段页加嵌入（去重）
  for (const rec of proposal.recollections) {
    const recPath = `${vaultRoot}/记忆/回忆/${rec.file}.md`;
    let recContent = '';
    let recCreated = date;
    if (await exists(fs, recPath)) {
      recContent = await readFileText(fs, recPath);
      const { fm } = parseFrontmatter(recContent);
      recCreated = fm.created || date;
    } else {
      const stageName = rec.file;
      recContent = serializeFrontmatter({
        title: stageName, type: 'journal', created: date, updated: date,
        tags: ['回忆', stageName], summary: `${stageName}时期的回忆。`,
      }) + `\n\n# ${stageName}\n\n> 从日记中按人生阶段归类整理的回忆。每条为日记对应段的块嵌入，改动日记原文此处同步更新。\n\n[[日记索引]]\n`;
    }
    const { body: recBody } = parseFrontmatter(recContent);
    const embedMark = `![[${year}#^${rec.blockId}]]`;
    if (recBody.includes(embedMark)) continue; // 已存在，去重
    const newRecBody = appendEmbedToDate(recBody, year, date, rec.blockId);
    const { fmText } = setFrontmatterField(recContent, 'updated', date);
    const newContent = fmText ? fmText + newRecBody : serializeFrontmatter({ title: rec.file, type: 'journal', created: recCreated, updated: date, tags: ['回忆', rec.file], summary: `${rec.file}时期的回忆。` }) + '\n' + newRecBody;
    proposal.files.push({ path: recPath, action: recContent ? 'update' : 'create', before: recContent, after: newContent });
  }

  // 8. 更新目录.md（新日记年份时登记）与 日志.md（追加 ingest 行）
  if (!(await exists(fs, diaryPath))) {
    const tocPath = `${vaultRoot}/记忆/目录.md`;
    if (await exists(fs, tocPath)) {
      let toc = await readFileText(fs, tocPath);
      if (!toc.includes(`[[${year}|${year}年日记]]`)) {
        const addLine = `- [[${year}|${year}年日记]] — ${year}年日记。@日记`;
        const newToc = toc + (toc.endsWith('\n') ? '' : '\n') + addLine + '\n';
        proposal.files.push({ path: tocPath, action: 'update', before: toc, after: newToc });
      }
    }
  }

  // 日志追加
  const logPath = `${vaultRoot}/记忆/日志.md`;
  if (await exists(fs, logPath)) {
    let log = await readFileText(fs, logPath);
    const hit = proposal.entitiesHit.join('、') || '无';
    const rec = proposal.recollections.length ? [...new Set(proposal.recollections.map((r) => r.file))].join('、') : '无';
    const cand = proposal.newCandidates.length ? [...new Set(proposal.newCandidates.map((c) => c.name))].join('、') : '无';
    const logEntry = `\n## [${date}] ingest | 今日速记\n\n手机 App 速记 ${paragraphs.length} 段，日期 ${date}。实体命中：${hit}；回忆归类：${rec}；疑似新实体：${cand}。\n`;
    proposal.files.push({ path: logPath, action: 'update', before: log, after: log + logEntry });
  }

  return proposal;
}

// 从段落前部提取特征词（转拼音），用于块 ID
function extractHintFromPara(para) {
  const cleaned = para.replace(/^[「『""''\s]+/, '');
  // 取前 4 个字（跳过标点），足够生成有区分度的特征
  let acc = '';
  for (const ch of cleaned) {
    if (/[一-鿿a-zA-Z0-9]/.test(ch)) acc += ch;
    if (acc.length >= 4) break;
  }
  return acc || 'entry';
}

// 疑似新实体提取（启发式，非 LLM）
const STOP_WORDS = new Set(['同学', '舍友', '朋友', '哥们', '兄弟', '老师', '师姐', '师兄', '房东', '老板', '同事', '学长', '学妹', '学弟', '我妈', '我爸', '爸妈', '父母', '家人', '姐姐', '哥哥', '妹妹', '弟弟', '爸爸', '妈妈', '他们', '我们', '你们', '大家', '一起', '晚上', '今天', '昨天', '明天', '一个', '两个', '后来', '以后', '之前', '现在', '那天', '那个', '这个', '时候', '他', '她']);
function extractCandidateNames(para, entities, hitNames) {
  const known = new Set([...Object.keys(entities), ...hitNames]);
  const candidates = [];
  const re = /(?:和|跟|与|约|找|喊|叫|带)([一-龥]{2,3}(?:[、，,][一-龥]{2,3}){0,4})/g;
  let m;
  while ((m = re.exec(para))) {
    const chunk = m[1];
    const names = chunk.split(/[、，,]/).map((s) => s.trim()).filter(Boolean);
    for (let name of names) {
      const mAction = name.match(/^(.*?)(?:一起|也|还|又|说|玩|吃|去|来|在|打|喝|走|到|和|跟|约|找|喊|叫|带|了|是|有|就)$/);
      if (mAction) name = mAction[1];
      name = name.slice(0, 4);
      if (name.length < 2) continue;
      if (known.has(name)) continue;
      if (STOP_WORDS.has(name)) continue;
      if (candidates.includes(name)) continue;
      candidates.push(name);
      known.add(name);
    }
  }
  return candidates.slice(0, 6);
}

export default { createProposal, detectStage, makeBlockId, slugify };
