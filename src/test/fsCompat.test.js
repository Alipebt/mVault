// fsCompat 测试：验证实体读取在无 listDir 的 fs（node:fs/promises）下正常工作
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsP from 'node:fs/promises';
import { loadEntityDict } from '../lib/entityDict.js';
import { indexVault } from '../lib/vaultIndex.js';
import { createProposal } from '../lib/linkEngine.js';
import { makeFixtureVault } from './fixture.js';

// 关键回归：node:fs/promises 只有 readdir（无 listDir）。
// 曾因 loadEntityDict 内部调用 fs.listDir 抛 TypeError 被空 catch 吞掉 → 返回空对象。
test('实体读取：node:fs/promises（无 listDir）能读到人物', async () => {
  const vault = await makeFixtureVault();
  // 注意：传入真实的 node:fs/promises，而非 fixture 的瘦 nodeFs（瘦的有 listDir）
  const dict = await loadEntityDict(fsP, vault);
  assert.ok(dict['薛圣道'], '应读到薛圣道');
  assert.ok(dict['薛圣道'].aliases.includes('薛哥'), '应从正文提取别名 薛哥');
});

test('链接引擎：node:fs/promises 下实体命中', async () => {
  const vault = await makeFixtureVault();
  const p = await createProposal(fsP, vault, { text: '今天跟薛哥打游戏。', date: '2026-08-15' });
  assert.ok(p.entitiesHit.includes('薛圣道'), '应命中薛圣道');
});

test('vaultIndex：node:fs/promises 下索引完整', async () => {
  const vault = await makeFixtureVault();
  const idx = await indexVault(fsP, vault);
  assert.ok(idx.people.some((x) => x.name === '薛圣道'), '应有薛圣道人物');
  assert.ok(idx.diary.length >= 3, `应有日记条目，实际 ${idx.diary.length}`);
  assert.ok(idx.nodes.length >= 4, `应有节点，实际 ${idx.nodes.length}`);
});
