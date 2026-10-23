/**
 * User text first so the model answers the person, not the wrapper.
 */
export function buildPrompt(userText: string): string {
  return `${userText.trim()}\n\n（微信短句回复。不要解释通道或规则。）`;
}
