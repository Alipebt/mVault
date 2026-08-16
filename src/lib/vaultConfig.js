// vaultConfig.js —— 记忆库路径配置
// 用户可自选记忆库路径（对应设计"数据存用户指定文件夹"）。
// 开发模式：持久化到 App/vault-config.json；手机端将来换成系统文件夹选择器。
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// App 根目录（vaultConfig.js 位于 App/src/lib/）
const APP_ROOT = path.resolve(__dirname, '../../');
const CONFIG_FILE = path.join(APP_ROOT, 'vault-config.json');
// 默认：App 上两级（即 D:\记录\记忆图谱，App 就放在记忆库根目录下）
const DEFAULT_VAULT = path.resolve(APP_ROOT, '../');

let currentVault = null;

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.vault) return cfg.vault;
  } catch { /* 无配置则用默认 */ }
  return null;
}

export async function initVaultConfig(envOverride) {
  const fromFile = await loadConfig();
  currentVault = envOverride || fromFile || DEFAULT_VAULT;
  return currentVault;
}

export function getVault() {
  return currentVault || DEFAULT_VAULT;
}

export async function setVault(newPath) {
  const p = path.resolve(newPath);
  // 校验：必须是存在的目录，且包含 记忆/ 子目录
  try {
    const st = await fs.stat(p);
    if (!st.isDirectory()) throw new Error('不是目录');
    const mem = path.join(p, '记忆');
    await fs.access(mem);
  } catch (e) {
    throw new Error(`无效的记忆库路径：${p}（需要是包含 记忆/ 目录的文件夹）`);
  }
  currentVault = p;
  await fs.writeFile(CONFIG_FILE, JSON.stringify({ vault: p }, null, 2), 'utf8');
  return p;
}

export { CONFIG_FILE, DEFAULT_VAULT };
export default { initVaultConfig, getVault, setVault, CONFIG_FILE, DEFAULT_VAULT };
