import { memo, useMemo, useState } from "react";
import Markdown from "./Markdown";
import Thinking from "./Thinking";
import { splitArtifact, stripDocMarkers } from "../lib/wordDoc";
import type { Msg } from "../types";

/** 单条消息行：React.memo 包裹后，流式期间只有内容变化的那条会重渲染，
 *  历史消息不再每个 token 都重新跑 splitArtifact / ReactMarkdown 解析。 */
function MessageRow({ m, index, isLast, streaming, imageBusy, codeMode, waiting, think, onOpenPanel, onRegenerate, onContinue, onEditUser, onBranch }: {
  m: Msg;
  /** 在会话里的下标（编辑重发要从这一条截断后续消息） */
  index: number;
  isLast: boolean;
  streaming: boolean;
  imageBusy: boolean;
  /** 代码请求：剥掉 DOC 标记按普通聊天全文显示（只影响最后一条） */
  codeMode: boolean;
  /** 流式已发出请求、还在等第一个 token */
  waiting: boolean;
  /** 思考过程开关：等待首 token 时显示「思考中…」还是「生成中…」 */
  think: boolean;
  onOpenPanel: () => void;
  onRegenerate: () => void;
  onContinue: () => void;
  /** 编辑某条用户消息并从该处重新生成（截断其后所有消息） */
  onEditUser: (index: number, text: string) => void;
  onBranch: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const sp = useMemo(() => {
    const raw = splitArtifact(m.content);
    return codeMode && isLast && m.role === "assistant"
      ? {
          ...raw,
          chat: stripDocMarkers(m.content),
          doc: null,
          xls: null,
          svg: null,
          streaming: false,
        }
      : raw;
  }, [m.content, m.role, codeMode, isLast]);

  function copyText(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  }

  function startEdit() {
    setDraft(m.content);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
  }

  function confirmEdit() {
    const t = draft.trim();
    if (!t || t === m.content) {
      cancelEdit();
      return;
    }
    setEditing(false);
    onEditUser(index, t);
  }

  if (m.role === "user") {
    if (m.content === "继续") {
      return (
        <div className="mb-4 flex justify-center">
          <span className="rounded-full border border-line bg-sand px-3 py-0.5 text-[12px] text-ink-soft">
            继续
          </span>
        </div>
      );
    }
    if (editing) {
      return (
        <div className="user-message-edit mb-6 flex justify-end">
          <div className="w-full max-w-[85%] rounded-2xl border border-clay/50 bg-surface px-3 py-2 shadow-[0_2px_10px_rgba(31,30,29,0.06)]">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(10, draft.split("\n").length + 1)}
              autoFocus
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  confirmEdit();
                } else if (e.key === "Escape") {
                  cancelEdit();
                }
              }}
            />
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-soft">Enter 保存并重发 · Esc 取消</span>
              <div className="flex gap-2">
                <button
                  onClick={cancelEdit}
                  className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-soft hover:bg-sand"
                >
                  取消
                </button>
                <button
                  onClick={confirmEdit}
                  disabled={!draft.trim()}
                  className="rounded-lg bg-clay px-2.5 py-1 text-[12px] text-white hover:bg-clay-deep disabled:opacity-40"
                >
                  保存并重发
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="user-message-row group mb-6 flex items-start justify-end gap-1.5 [content-visibility:auto] [contain-intrinsic-size:auto_80px]">
        <div className="flex flex-col gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => copyText(m.content)}
            title={copied ? "已复制" : "复制"}
            className="rounded-md p-1 text-ink-soft hover:bg-sand hover:text-ink"
          >
            {copied ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
          {!streaming && (
            <button
              onClick={startEdit}
              title="编辑并重新发送（截断其后的消息）"
              className="rounded-md p-1 text-ink-soft hover:bg-sand hover:text-ink"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
          <div className="user-message-bubble max-w-[85%] rounded-2xl border border-line bg-sand px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
            {m.content}
            {m.attachments?.map((a) => <div key={a.name} className="mt-1 text-[11px] text-ink-soft">📎 {a.name}</div>)}
          </div>
          {!streaming && <button onClick={onBranch} title="从此消息创建对话分支" className="mt-2 rounded-md px-1 py-1 text-[11px] text-ink-soft opacity-0 hover:bg-sand group-hover:opacity-100">分支</button>}
      </div>
    );
  }

  const plain = sp.chat.trim() || m.content;
  const showRowActions = isLast && !streaming && (m.content || m.truncated);

  return (
    // content-visibility：屏幕外的消息跳过渲染/布局，长会话滚动更顺
    <div className="assistant-message-row group mb-6 flex gap-3 [content-visibility:auto] [contain-intrinsic-size:auto_200px]">
      <div className="assistant-message-content min-w-0 flex-1 text-[15px]">
        {m.reasoning ? (
          <Thinking
            text={m.reasoning}
            seconds={m.thinkSeconds}
            live={streaming && isLast && !m.content}
          />
        ) : null}
        {sp.chat.trim() || sp.xls ? (
          <>
            <Markdown
              text={sp.xls ? sp.chat.replace(/^[ \t]*图表[:：].*$/m, "").trim() : sp.chat}
            />
            {streaming && isLast && <span className="caret" />}
          </>
        ) : waiting && isLast && !m.reasoning ? (
          <span className="shimmer text-[14px]">
            {think ? "思考中…" : "生成中…"}
          </span>
        ) : null}
        {sp.doc || sp.xls || sp.svg ? (
          <button
            onClick={onOpenPanel}
            title="在右侧面板中查看"
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-sand px-3 py-1.5 text-[12px] text-clay-deep hover:bg-surface"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              {sp.svg ? (
                <path
                  d="M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : sp.xls ? (
                <path
                  d="M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              ) : (
                <path
                  d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zm0 0v5h5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
            {streaming && isLast && sp.streaming
              ? sp.svg
                ? "正在绘制图像…"
                : sp.xls
                  ? "正在更新表格…"
                  : "正在更新文档…"
              : sp.svg
                ? "图像已生成 · 查看"
                : sp.xls
                  ? "表格已更新 · 查看"
                  : "文档已更新 · 查看"}
          </button>
        ) : null}
        {m.imageGen ? (
          <button
            onClick={onOpenPanel}
            title="在右侧面板中查看"
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-sand px-3 py-1.5 text-[12px] text-clay-deep hover:bg-surface"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6M9 8.5a1 1 0 11-2 0 1 1 0 012 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {imageBusy && isLast ? "正在绘制图像…" : "图像已生成 · 查看"}
          </button>
        ) : null}
        {plain || showRowActions ? (
          <div
            className={`mt-2 flex items-center gap-4 text-[12px] text-ink-soft ${
              showRowActions
                ? ""
                : "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
            }`}
          >
            {plain ? (
              <button
                onClick={() => copyText(plain)}
                className="flex items-center gap-1 hover:text-ink"
                title={copied ? "已复制" : "复制回答"}
              >
                {copied ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {copied ? "已复制" : "复制"}
              </button>
            ) : null}
            {showRowActions ? (
              <>
                <button
                  onClick={onRegenerate}
                  className="flex items-center gap-1 hover:text-ink"
                  title="重新生成这条回答"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  重新生成
                </button>
                {m.truncated && (
                  <button
                    onClick={onContinue}
                    className="flex items-center gap-1 text-clay-deep hover:text-ink"
                    title="继续被截断的回答"
                  >
                    继续 ↓
                  </button>
                )}
              </>
            ) : null}
            {!streaming && <button onClick={onBranch} className="flex items-center gap-1 hover:text-ink" title="从此消息创建对话分支">分支</button>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(MessageRow);
