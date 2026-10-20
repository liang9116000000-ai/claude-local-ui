import { memo, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { runJsInSandbox } from "../lib/runJs";

/** 右侧滑出面板：HTML / Mermaid 预览共用 */
function SidePreview({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <div className="fixed inset-y-0 right-0 z-40 flex w-[52%] min-w-[360px] max-w-[720px] flex-col border-l border-line bg-cream shadow-[-8px_0_24px_rgba(31,30,29,0.12)]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <span className="text-[13px] font-medium">{title}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          title="关闭预览"
          className="rounded-lg p-1 text-ink-soft hover:bg-sand"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}

function CodeBlock({ children, className }: {
  children: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState(false);
  const [mmdSvg, setMmdSvg] = useState<string | null>(null);
  const [mmdErr, setMmdErr] = useState<string | null>(null);
  const [mmdLoading, setMmdLoading] = useState(false);
  const [pretty, setPretty] = useState(false);
  const lang = /language-(\S+)/.exec(className || "")?.[1] || "";
  // JS 系语言、或模型没标语言的裸代码块，都提供运行按钮（裸块按 JS 执行）
  const isJs = !lang || /^(js|javascript|node|mjs)$/i.test(lang);
  const isHtml = /^(html|htm|xhtml)$/i.test(lang);
  const isMermaid = /^mermaid$/i.test(lang);
  const isJson = /^(json|jsonc)$/i.test(lang);

  async function run() {
    if (running) return;
    setRunning(true);
    setOutput(null);
    const logs = await runJsInSandbox(children);
    setOutput(logs.length ? logs : ["（执行完毕，无 console 输出）"]);
    setRunning(false);
  }

  async function showMermaid() {
    if (preview) {
      setPreview(false);
      return;
    }
    setPreview(true);
    if (mmdSvg || mmdErr || mmdLoading) return;
    setMmdLoading(true);
    try {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
      });
      const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
      const { svg } = await mermaid.render(id, children);
      setMmdSvg(svg);
      setMmdErr(null);
    } catch (e) {
      setMmdSvg(null);
      setMmdErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setMmdLoading(false);
    }
  }

  const codeToShow = isJson && pretty
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(children), null, 2);
        } catch {
          return children;
        }
      })()
    : children;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[#3a382f]">
      <div className="flex items-center justify-between bg-[#26251f] px-3 py-1.5">
        <span className="text-xs text-[#a8a49a]">{lang || "代码"}</span>
        <div className="flex items-center gap-3">
          {isMermaid ? (
            <button
              className="text-xs text-[#a8a49a] hover:text-white disabled:opacity-50"
              onClick={showMermaid}
              disabled={mmdLoading}
              title="在右侧面板渲染 Mermaid 图"
            >
              {preview ? "收起图表" : mmdLoading ? "渲染中…" : "▶ 图表"}
            </button>
          ) : isHtml ? (
            <button
              className="text-xs text-[#a8a49a] hover:text-white"
              onClick={() => setPreview((v) => !v)}
              title="在右侧面板渲染这个 HTML 页面"
            >
              {preview ? "收起预览" : "▶ 预览"}
            </button>
          ) : isJs ? (
            <button
              className="text-xs text-[#a8a49a] hover:text-white disabled:opacity-50"
              onClick={run}
              disabled={running}
              title="在本地浏览器沙箱里执行这段 JavaScript，显示 console 输出"
            >
              {running ? "运行中…" : output ? "重新运行" : "▶ 运行"}
            </button>
          ) : isJson ? (
            <button
              className="text-xs text-[#a8a49a] hover:text-white"
              onClick={() => setPretty((v) => !v)}
              title="格式化 / 压缩 JSON"
            >
              {pretty ? "原始" : "格式化"}
            </button>
          ) : (
            <span
              className="text-xs text-[#6f6b60]"
              title="浏览器内可运行 JS、预览 HTML、渲染 Mermaid；其它语言请复制到本地执行"
            >
              不可在线运行
            </span>
          )}
          <button
            className="text-xs text-[#a8a49a] hover:text-white"
            onClick={() => {
              navigator.clipboard.writeText(children).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto bg-[#1f1e1a] p-3 text-[13px] leading-relaxed text-[#e8e4d9]">
        <code>{codeToShow}</code>
      </pre>
      {preview && isHtml ? (
        <SidePreview title="HTML 预览" onClose={() => setPreview(false)}>
          <iframe
            title="HTML 预览"
            sandbox="allow-scripts"
            srcDoc={children}
            className="w-full flex-1 border-0 bg-white"
          />
        </SidePreview>
      ) : null}
      {preview && isMermaid ? (
        <SidePreview title="Mermaid 图表" onClose={() => setPreview(false)}>
          <div className="flex flex-1 items-center justify-center overflow-auto bg-white p-6">
            {mmdSvg ? (
              <div className="max-w-full [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: mmdSvg }} />
            ) : mmdErr ? (
              <div className="max-w-md rounded-xl border border-line bg-surface p-4 text-[13px] text-ink-soft">
                渲染失败：{mmdErr}
              </div>
            ) : (
              <span className="shimmer text-[13px]">正在渲染图表…</span>
            )}
          </div>
        </SidePreview>
      ) : null}
      {output ? (
        <div className="border-t border-[#3a382f] bg-[#16150f] px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-[#6f6b60]">
            输出
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-[#c8e6c9]">
            {output.join("\n")}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** memo：text 没变就跳过整个 ReactMarkdown 解析（流式期间历史消息零开销）。 */
function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...rest }) => {
            const raw = String(children).replace(/\n$/, "");
            const isBlock = (className?.includes("language-") || raw.includes("\n")) ?? false;
            if (!isBlock) {
              return <code className={className} {...rest}>{children}</code>;
            }
            return <CodeBlock className={className}>{raw}</CodeBlock>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
