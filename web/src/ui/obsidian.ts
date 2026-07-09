/**
 * ui/obsidian.ts — obsidian:// 跳转 URI 构造（cards.ts 与各面板共用，避免复制字符串拼接）。
 */

/** vaultAbsPath 为 vault 绝对路径，notePath 为 vault 相对路径 */
export function obsidianUri(vaultAbsPath: string, notePath: string): string {
  return 'obsidian://open?path=' + encodeURIComponent(vaultAbsPath + '/' + notePath);
}
