// personFactory.js —— "新建人物"功能
// 输入必要信息（姓名/别名/关系/标签/备注），生成记忆/人物/<姓名>.md，
// 并补全目录.md 登记与人物页 backlinks。
// 用户不直接操作 md —— 这是 App 的一个表单功能。

import { serializeFrontmatter, parseFrontmatter } from './markdown.js';
import { exists, mkdir, readFileText, writeFileText } from './fsCompat.js';

export async function createPersonPage(fs, vaultRoot, { name, aliases = [], relation = '', tags = [], summary = '', note = '' }) {
  const fileName = `${name}.md`;
  const dir = `${vaultRoot}/记忆/人物`;
  const filePath = `${dir}/${fileName}`;
  const today = new Date().toISOString().slice(0, 10);

  const fm = {
    title: name,
    type: 'entity',
    created: today,
    updated: today,
    tags: ['人物', ...tags],
    summary: summary || (relation ? `${relation}，待补充记忆线索` : '人物志，待补充'),
    aliases,
  };
  // 别名存 frontmatter aliases
  const body = `# ${name}\n\n> 人物志：由手机 App 新建。` + (relation ? ` 与作者关系：${relation}。` : '') + `\n\n## 身份与关系\n\n${note ? note : '- 待补充。'}\n\n<!-- TODO: 待补充记忆线索 -->\n\n## 记忆线索\n\n（速记命中后自动追加）\n\n## 待补充\n\n- 与作者的关系细节。\n`;
  const content = serializeFrontmatter(fm) + '\n' + body;

  // 写文件
  await mkdir(fs, dir);
  await writeFileText(fs, filePath, content);

  // 补全目录.md（目录.md 无 frontmatter，绝不能用 serializeFrontmatter 前置空行）
  const tocPath = `${vaultRoot}/记忆/目录.md`;
  if (await exists(fs, tocPath)) {
    let toc = await readFileText(fs, tocPath);
    const { fm: tocFm, body: tocBody } = parseFrontmatter(toc);
    if (!tocBody.includes(`[[${name}]]`)) {
      const addLine = `- [[${name}]] — ${fm.summary}。@人物`;
      const newTocBody = tocBody + (tocBody.endsWith('\n') ? '' : '\n') + addLine + '\n';
      const newContent = Object.keys(tocFm).length ? serializeFrontmatter(tocFm) + '\n' + newTocBody : newTocBody;
      await writeFileText(fs, tocPath, newContent);
    }
  }

  // 补日志
  const logPath = `${vaultRoot}/记忆/日志.md`;
  if (await exists(fs, logPath)) {
    let log = await readFileText(fs, logPath);
    const entry = `\n## [${today}] ingest | 新建人物 ${name}\n\n手机 App 新建人物页：${name}` + (aliases.length ? `（别名：${aliases.join('、')}）` : '') + `。已更新目录.md。\n`;
    await writeFileText(fs, logPath, log + entry);
  }

  return { filePath, name, aliases };
}

export default { createPersonPage };
