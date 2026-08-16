// gitClient 测试：用临时 git 仓库验证 status / discard（未跟踪文件删除）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import gitClient from '../lib/gitClient.js';

async function makeRepo() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'git-test-'));
  await gitClient.initRepo(fsp, dir, { userName: 'test', userEmail: 't@t.com' });
  // 建一个跟踪文件并提交
  await fsp.writeFile(path.join(dir, 'tracked.md'), 'original\n');
  await gitClient.addAll(fsp, dir, ['tracked.md']);
  await gitClient.commit(fsp, dir, { message: 'init', author: { name: 'test', email: 't@t.com' } });
  return dir;
}

test('git status：干净仓库无改动', async () => {
  const dir = await makeRepo();
  const st = await gitClient.status(fsp, dir);
  assert.deepEqual(st, [], '干净仓库不应有改动');
});

test('git status：识别未跟踪文件与工作区改动', async () => {
  const dir = await makeRepo();
  await fsp.writeFile(path.join(dir, 'untracked.md'), 'new\n');
  await fsp.appendFile(path.join(dir, 'tracked.md'), 'changed\n');
  const st = await gitClient.status(fsp, dir);
  const byPath = Object.fromEntries(st.map((s) => [s.filePath, s.status]));
  assert.equal(byPath['untracked.md'], 'untracked', '未跟踪文件应标 untracked');
  assert.equal(byPath['tracked.md'], 'modified', '工作区改动应标 modified');
  // 干净文件不应出现
  assert.ok(!st.some((s) => s.filePath === 'README.md'), '不应出现多余文件');
});

test('git discard：未跟踪文件被删除', async () => {
  const dir = await makeRepo();
  await fsp.writeFile(path.join(dir, 'untracked.md'), 'new\n');
  const r = await gitClient.discard(fsp, dir, ['untracked.md']);
  assert.equal(r[0].discarded, true, '未跟踪文件应被丢弃');
  const ex = await fsp.access(path.join(dir, 'untracked.md')).then(() => true).catch(() => false);
  assert.equal(ex, false, '未跟踪文件应被删除');
});

test('git discard：已跟踪文件恢复到 HEAD', async () => {
  const dir = await makeRepo();
  await fsp.appendFile(path.join(dir, 'tracked.md'), 'changed\n');
  await gitClient.discard(fsp, dir, ['tracked.md']);
  const content = await fsp.readFile(path.join(dir, 'tracked.md'), 'utf8');
  assert.equal(content, 'original\n', '已跟踪文件应恢复到 HEAD');
});
