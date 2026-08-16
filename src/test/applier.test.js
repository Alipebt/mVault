// applier 测试：真实行级 diff（LCS）与落盘校验
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, diffText, isInside } from '../lib/applier.js';

test('diffLines：识别新增/删除/相同行', () => {
  const before = 'a\nb\nc';
  const after = 'a\nb\nd';
  const ops = diffLines(before, after);
  const types = ops.map((o) => o.type);
  assert.ok(types.includes('same'), '应有相同行');
  assert.ok(types.includes('del') && types.some((t, i) => t === 'del' && ops[i].text === 'c'), '应识别删除 c');
  assert.ok(types.includes('add') && types.some((t, i) => t === 'add' && ops[i].text === 'd'), '应识别新增 d');
});

test('diffText：无变化返回占位', () => {
  assert.equal(diffText('abc', 'abc'), '(无变化)');
});

test('diffText：行顺序 diff 不误报（Set 比较的旧 bug 回归）', () => {
  // 旧实现用 Set，交换两行顺序会误报"全部新增"
  const before = '第一行\n第二行';
  const after = '第二行\n第一行';
  const text = diffText(before, after);
  // 应包含 - 与 + 各代表交换，而不是把所有行都标 +
  assert.ok(text.includes('- '), '应有删除标记');
  assert.ok(text.includes('+ '), '应有新增标记');
});

test('isInside：路径越界判断', () => {
  assert.ok(isInside('/a/b/c.md', '/a/b'));
  assert.ok(isInside('/a/b', '/a/b'));
  assert.ok(!isInside('/a/bc/x.md', '/a/b'), '前缀劫持应被拒绝');
  assert.ok(!isInside('/other/x.md', '/a/b'));
});
