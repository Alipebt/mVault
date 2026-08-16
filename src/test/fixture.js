// fixture.js —— 构建符合 CLAUDE.md 规范的最小测试记忆库
// 供单元测试使用；每次在临时目录生成一份独立副本，不污染真实记忆库。
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const nodeFs = {
  readFile: (p) => fs.readFile(p, 'utf8'),
  writeFile: (p, d) => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, d, 'utf8')),
  exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
  listDir: (p) => fs.readdir(p),
  mkdir: (p) => fs.mkdir(p, { recursive: true }),
};

// 生成一份最小但格式规范的记忆库
export async function makeFixtureVault() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memvault-'));
  const mem = path.join(root, '记忆');
  for (const sub of ['日记', '人物', '回忆']) {
    await fs.mkdir(path.join(mem, sub), { recursive: true });
  }

  // 2024 日记：两个日期节，一个带回忆块 ID
  await fs.writeFile(path.join(mem, '日记', '2024.md'), `---
title: "2024年日记"
type: journal
date: 2024
raw_date: "2024年"
created: 2024-09-28
updated: 2024-12-01
tags: [日记]
source: "数据/文字/2024年.docx"
summary: "2024年日记。"
---

# 2024年日记

[[日记索引]]

## 2024-10-01

今天开始复习考研数学，晚上跟薛圣道一起打游戏。 ^college-kaoyan-math

## 2024-10-15

回忆初中那会儿，每天骑车上学。 ^middle-bike-school
`);

  // 2025 日记（供跨年/多段测试）
  await fs.writeFile(path.join(mem, '日记', '2025.md'), `---
title: "2025年日记"
type: journal
date: 2025
raw_date: "2025年"
created: 2025-01-03
updated: 2025-06-01
tags: [日记]
source: "数据/文字/2025年.docx"
summary: "2025年日记。"
---

# 2025年日记

[[日记索引]]

## 2025-03-10

薛哥来宿舍串门，一起看比赛。
`);

  // 人物：薛圣道（frontmatter 无 aliases，别名在正文首段——测试兼容逻辑）
  await fs.writeFile(path.join(mem, '人物', '薛圣道.md'), `---
title: "薛圣道"
type: entity
created: 2024-10-01
updated: 2024-12-01
tags: [人物, 大学同学]
summary: "本科同学兼好友。"
---

# 薛圣道

> 人物志：日记中常写作"薛圣道"，亦称"薛哥"、"xsd"。

## 身份与关系

- 大学本科同学。

## 记忆线索

- [[2024#2024-10-01|2024-10-01]]：一起打游戏。
`);

  // 人物说明
  await fs.writeFile(path.join(mem, '人物', '说明.md'), `# 人物

一人一页。文件名即人名。
`);

  // 回忆：高中（无内容）、大学（一条嵌入）
  await fs.writeFile(path.join(mem, '回忆', '高中.md'), `---
title: "高中"
type: journal
created: 2024-10-01
updated: 2024-12-01
tags: [回忆, 高中]
summary: "高中时期的回忆。"
---

# 高中

> 从日记中按人生阶段归类整理的回忆。

[[日记索引]]
`);

  await fs.writeFile(path.join(mem, '回忆', '大学.md'), `---
title: "大学"
type: journal
created: 2024-10-01
updated: 2024-12-01
tags: [回忆, 大学]
summary: "大学本科时期的回忆，含考研阶段。"
---

# 大学

> 从日记中按人生阶段归类整理的回忆。

[[日记索引]]

## [[2024#2024-10-01|2024-10-01]]

![[2024#^college-kaoyan-math]]
`);

  // 回忆说明
  await fs.writeFile(path.join(mem, '回忆', '说明.md'), `# 回忆

按人生阶段归类的回忆。每条为日记对应段的块嵌入。
`);

  // 目录.md（无 frontmatter！）
  await fs.writeFile(path.join(mem, '目录.md'), `# 目录

按类别分组的记忆索引。

## 日记

- [[日记索引]] — 日记页索引。@日记
- [[2024|2024年日记]] — 2024年日记。@日记
- [[2025|2025年日记]] — 2025年日记。@日记

## 人物

- [[薛圣道]] — 本科同学兼好友。@人物

## 回忆

- [[高中]] — 高中时期的回忆。@回忆
- [[大学]] — 大学本科时期的回忆。@回忆
`);

  // 日志.md（无 frontmatter！）
  await fs.writeFile(path.join(mem, '日志.md'), `# 日志

追加式操作记录，不改旧条目。

## [2024-10-01] ingest | 初始 fixture
`);

  // 日记索引
  await fs.writeFile(path.join(mem, '日记', '日记索引.md'), `---
title: "日记索引"
type: journal
created: 2024-10-01
updated: 2024-12-01
tags: [日记, 索引]
summary: "日记页索引。"
---

# 日记索引

- [[2024|2024年日记]] — 2024年日记。@日记
`);

  return root;
}

export default { makeFixtureVault, nodeFs };
