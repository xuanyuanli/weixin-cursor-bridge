export const WECHAT_CONSTRAINT = [
  "你正在通过微信被遥控。回复必须精简，适合手机阅读。",
  "有选择时用 1. 2. 3. 列出，不要大段代码（给路径+要点）。",
  "单条回复控制在 1500 字内。",
].join("\n");

/**
 * Wrap user draft with the WeChat reply contract.
 */
export function buildPrompt(userText: string): string {
  return `${WECHAT_CONSTRAINT}\n\n${userText}`;
}
