// slugify.js —— 中文 → 英文特征词（用于 Obsidian 块 ID）
// 零 LLM：用 pinyin-pro 把中文转拼音；混合串逐字处理，结果英文小写+连字符。
// 若输入为空或转换失败，返回 'entry'（降级，与旧行为一致）。

import { pinyin } from 'pinyin-pro';

/**
 * 把任意文本转成英文小写 + 连字符的特征词。
 * - 中文 → 拼音（逐字，无声调）
 * - 已有英文/数字 → 保留小写
 * - 其他字符 → 折叠为单个连字符
 * @param {string} str
 * @returns {string} 例如 '薛圣道' → 'xueshengdao'；'王梓悦回忆' → 'wangziyuehuiyi'
 */
export function toPinyin(str) {
  if (!str) return 'entry';
  let out = '';
  for (const ch of String(str)) {
    if (/[一-鿿]/.test(ch)) {
      try {
        const py = pinyin(ch, { toneType: 'none' });
        out += py;
      } catch {
        out += '';
      }
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      out += ch.toLowerCase();
    }
  }
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'entry';
}

export default { toPinyin };
