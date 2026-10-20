import type { ApiMessage } from "./types";
import { API_MODEL_ALIAS } from "./lib/model";

// 统一同源访问：dev 走 vite 代理 /v1；生产由部署服务器 nginx 反代（+ SSH 反向隧道）到本机模型服务。
// 不能直连 http://127.0.0.1:8000：公网 HTTP 页面不是安全上下文，Chrome 会以
// net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS 拦截对 loopback 的请求。VITE_API_BASE 可覆盖。
const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) || "";

export interface StreamOpts {
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  /** live reasoning trace deltas (delta.reasoning_content) */
  onReasoning?: (text: string) => void;
  /** knowledge-base mode: general | tcm | counselor */
  kb?: string;
  /** false = skip the reasoning trace (server pre-closes the think block) */
  thinking?: boolean;
  maxTokens?: number;
  onUsage?: (usage: TokenUsage) => void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** POST /v1/chat/completions (stream); resolves with the finish reason. */
export async function streamChat(
  messages: ApiMessage[],
  opts: StreamOpts,
): Promise<string | null> {
  const requestBody = {
    model: API_MODEL_ALIAS,
    messages,
    stream: true,
    kb: opts.kb || "general",
    thinking: opts.thinking ?? true,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: 0.6,
  };
  const request = (body: object) => fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  let res = await request({ ...requestBody, stream_options: { include_usage: true } });
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const error = await res.clone().text().catch(() => "");
    // Older local OpenAI-compatible servers may reject this standard option.
    // Retry without it so token analytics never prevents a chat request.
    if (/stream_options|include_usage/i.test(error)) res = await request(requestBody);
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  let finish: string | null = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:") || line.startsWith("data: [DONE]")) continue;
      try {
        const json = JSON.parse(line.slice(5)) as {
          choices?: {
            delta?: { content?: string; reasoning_content?: string };
            finish_reason?: string;
          }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        const usage = json.usage;
        if (usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
          const inputTokens = Math.max(0, Math.round(usage.prompt_tokens!));
          const outputTokens = Math.max(0, Math.round(usage.completion_tokens!));
          opts.onUsage?.({
            inputTokens,
            outputTokens,
            totalTokens: Number.isFinite(usage.total_tokens)
              ? Math.max(0, Math.round(usage.total_tokens!))
              : inputTokens + outputTokens,
          });
        }
        const fr = json.choices?.[0]?.finish_reason;
        if (fr) finish = fr;
        const think = json.choices?.[0]?.delta?.reasoning_content;
        if (think) opts.onReasoning?.(think);
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) opts.onDelta(piece);
      } catch {
        // partial or keep-alive lines are ignored
      }
    }
  }
  return finish;
}
