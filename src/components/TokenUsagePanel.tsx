import { useEffect, useMemo, useState } from "react";
import type { Conv, TokenUsage } from "../types";
import { MODEL_DISPLAY_NAME } from "../lib/model";

type Scope = "all" | "current";

function isUsage(value: TokenUsage | undefined): value is TokenUsage {
  return !!value && [value.inputTokens, value.outputTokens, value.totalTokens].every(
    (count) => Number.isFinite(count) && count >= 0,
  );
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function TokenBar({ input, output }: { input: number; output: number }) {
  const total = input + output;
  const inputPercent = total ? (input / total) * 100 : 50;
  return (
    <div className="usage-bar" aria-label={`输入 ${formatTokens(input)}，输出 ${formatTokens(output)}`}>
      <span style={{ width: `${inputPercent}%` }} />
      <span style={{ width: `${100 - inputPercent}%` }} />
    </div>
  );
}

export default function TokenUsagePanel({ convs, activeId, onClose }: {
  convs: Conv[];
  activeId: string | null;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const active = convs.find((conv) => conv.id === activeId) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const allRows = useMemo(() => convs.flatMap((conv) =>
      conv.messages.flatMap((message, index) =>
      message.role === "assistant" && isUsage(message.tokenUsage)
        ? [{ conv, index, usage: message.tokenUsage }]
        : [],
    ),
  ), [convs]);
  const rows = useMemo(() => {
    const selected = scope === "current" && active ? allRows.filter((row) => row.conv.id === active.id) : allRows;
    const seen = new Set<string>();
    const unique = selected.filter((row) => {
      const id = row.usage.id || `${row.conv.id}-${row.index}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return unique.reverse();
  }, [active, allRows, scope]);
  const totals = rows.reduce((sum, row) => ({
    input: sum.input + row.usage.inputTokens,
    output: sum.output + row.usage.outputTokens,
    total: sum.total + row.usage.totalTokens,
  }), { input: 0, output: 0, total: 0 });

  return (
    <div className="usage-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="usage-panel" role="dialog" aria-modal="true" aria-labelledby="usage-title">
        <header className="usage-panel-header">
          <div>
            <h2 id="usage-title">Token 用量分析</h2>
            <p title={MODEL_DISPLAY_NAME}>模型：{MODEL_DISPLAY_NAME}</p>
          </div>
          <button className="usage-close" onClick={onClose} aria-label="关闭用量分析" title="关闭">×</button>
        </header>

        <div className="usage-scope" role="tablist" aria-label="用量统计范围">
          <button role="tab" aria-selected={scope === "all" || !active} onClick={() => setScope("all")}>全部会话</button>
          <button role="tab" aria-selected={scope === "current" && !!active} disabled={!active} onClick={() => setScope("current")}>当前会话</button>
        </div>

        <div className="usage-summary">
          <article className="usage-total-card">
            <span>累计 Token</span>
            <strong>{formatTokens(totals.total)}</strong>
            <small>{rows.length} 次模型生成</small>
          </article>
          <article><span>输入</span><strong>{formatTokens(totals.input)}</strong></article>
          <article><span>输出</span><strong>{formatTokens(totals.output)}</strong></article>
        </div>

        <div className="usage-list-heading">
          <h3>生成明细</h3>
          {rows.length > 0 && <span>最近 {Math.min(rows.length, 50)} 次</span>}
        </div>
        {rows.length ? (
          <div className="usage-list">
            {rows.slice(0, 50).map(({ conv, index, usage }) => (
              <article className="usage-row" key={`${conv.id}-${index}`}>
                <div className="usage-row-top">
                  <div className="usage-row-title">
                    <strong>{conv.title || "新对话"}</strong>
                    <span>回复 {conv.messages.slice(0, index + 1).filter((item) => item.role === "assistant").length}</span>
                  </div>
                  <span className={`usage-source ${usage.source === "server" ? "is-server" : ""}`}>
                    {usage.source === "server" ? "服务端记录" : "文本估算"}
                  </span>
                </div>
                <TokenBar input={usage.inputTokens} output={usage.outputTokens} />
                <div className="usage-row-counts">
                  <span>输入 {formatTokens(usage.inputTokens)}</span>
                  <span>输出 {formatTokens(usage.outputTokens)}</span>
                  <strong>共 {formatTokens(usage.totalTokens)}</strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="usage-empty">
            <span aria-hidden="true">▤</span>
            <strong>还没有用量记录</strong>
            <p>从现在开始记录新生成的用量；已有对话不会追溯估算。</p>
          </div>
        )}
        <p className="usage-note">
          服务端返回的输入量使用模型 tokenizer 统计；当前服务端的输出量按文本长度折算。无服务端记录时，输入和输出都按文本长度估算。每轮输入包含系统提示和本轮上下文；图像绘制本身不计入 token。
        </p>
      </section>
    </div>
  );
}
