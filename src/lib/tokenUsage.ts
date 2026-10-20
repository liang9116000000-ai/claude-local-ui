import type { ApiMessage, TokenUsage } from "../types";

function createUsageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Rough display estimate for Qwen-style text; this is not a model tokenizer. */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu)?.length ?? 0;
  const rest = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu, "");
  const words = rest.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? [];
  const latin = words.reduce((sum, word) => sum + Math.max(1, Math.ceil(word.length / 4)), 0);
  const symbols = [...rest.replace(/[A-Za-z0-9\s]/g, "")].length;
  return cjk + latin + symbols;
}

export function estimatePromptTokens(messages: ApiMessage[]): number {
  return 3 + messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
}

export function makeEstimatedPromptUsage(messages: ApiMessage[], outputText: string): TokenUsage {
  const inputTokens = estimatePromptTokens(messages);
  const outputTokens = estimateTokens(outputText);
  return { id: createUsageId(), inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, source: "estimate" };
}
