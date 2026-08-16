// vaultIndex 测试：验证索引输出（用自建 fixture）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexVault } from '../lib/vaultIndex.js';
import { makeFixtureVault, nodeFs } from './fixture.js';

test('vaultIndex：节点、日记、人物、回忆齐全', async () => {
  const vault = await makeFixtureVault();
  const idx = await indexVault(nodeFs, vault);

  assert.ok(idx.nodes.some((n) => n.id === '2024'), '应有2024日记节点');
  assert.ok(idx.nodes.some((n) => n.title === '薛圣道'), '应有薛圣道节点');
  assert.ok(idx.nodes.some((n) => n.id === '高中'), '应有高中回忆节点');

  // 日记条目：fixture 有 2024 两条 + 2025 一条
  assert.ok(idx.diary.length >= 3, `日记条目应 ≥3，实际 ${idx.diary.length}`);
  assert.match(idx.diary[0].date, /^\d{4}-\d{2}-\d{2}$/, '日期格式');

  // 人物
  assert.ok(idx.people.some((p) => p.name === '薛圣道'), '应有薛圣道人物');
  const xs = idx.people.find((p) => p.name === '薛圣道');
  // 兼容逻辑：正文首段"亦称薛哥、xsd"应被提取为别名
  assert.ok(Array.isArray(xs.aliases), '别名应为数组');
  assert.ok(xs.aliases.includes('薛哥'), '应从正文提取别名 薛哥');
  assert.ok(xs.aliases.includes('xsd'), '应从正文提取别名 xsd');

  // 回忆
  assert.ok(idx.recollections.some((r) => r.stage === '大学'), '应有大学回忆');
  assert.ok(idx.recollections.some((r) => r.blockId === 'college-kaoyan-math'), '应解析大学回忆块ID');
});

test('vaultIndex：日记段落不包含块ID垃圾行', async () => {
  const vault = await makeFixtureVault();
  const idx = await indexVault(nodeFs, vault);
  const entry = idx.diary.find((d) => d.date === '2024-10-01');
  assert.ok(entry, '应有 2024-10-01 条目');
  assert.ok(entry.paras.length === 1, '该日期应有 1 段');
  assert.ok(entry.paras[0].includes('复习考研数学'), '段内容应保留');
  assert.ok(!/\^college-kaoyan-math/.test(entry.paras[0]), '段内容不应含块ID');
});

test('vaultIndex：链接边存在且指向已知节点', async () => {
  const vault = await makeFixtureVault();
  const idx = await indexVault(nodeFs, vault);
  const xsEdges = idx.edges.filter((e) => e.source === '薛圣道');
  assert.ok(xsEdges.some((e) => e.target === '2024'), '薛圣道应链接到2024日记');
  const recEdges = idx.edges.filter((e) => e.source === '高中');
  assert.ok(recEdges.length > 0, '高中回忆页应有出站链接');
});

test('vaultIndex：回忆嵌入解析块ID且为英文小写+连字符', async () => {
  const vault = await makeFixtureVault();
  const idx = await indexVault(nodeFs, vault);
  assert.ok(idx.recollections.length >= 1, '应有回忆条目');
  assert.ok(idx.recollections.every((r) => /^[a-z][a-z0-9-]*$/.test(r.blockId)), '块ID应为英文小写+连字符');
});
