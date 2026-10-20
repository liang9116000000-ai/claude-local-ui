import { useEffect, useMemo, useState } from "react";
import { sanitizeSvg } from "../lib/wordDoc";

/** 右侧的矢量图像面板：SVG 实时预览 + 导出 PNG / SVG。 */
export default function ImagePanel({ name, code, live, onClose }: {
  name: string;
  /** SVG 标记内的原始代码（允许流式半截，未完成时显示占位） */
  code: string;
  /** 模型正在流式绘制 */
  live: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"png" | "svg" | null>(null);
  const [failed, setFailed] = useState(false);
  /** 记录渲染失败的那份代码；safe 一变（新内容到达）自动解除失败态 */
  const [brokenCode, setBrokenCode] = useState<string | null>(null);

  // 完整（已闭合）且消毒过的代码才交给 <img> 渲染；<img> 里的 SVG 不执行脚本
  const complete = !live || /<\/svg\s*>\s*$/i.test(code.trim());
  const safe = useMemo(() => sanitizeSvg(code), [code]);
  const broken = brokenCode === safe;
  const url = useMemo(
    () => (complete ? URL.createObjectURL(new Blob([safe], { type: "image/svg+xml;charset=utf-8" })) : null),
    [complete, safe],
  );
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function download(kind: "png" | "svg") {
    if (busy) return;
    setBusy(kind);
    setFailed(false);
    try {
      const mod = await import("../lib/svgExport");
      if (kind === "svg") await mod.downloadSvg(name, code);
      else await mod.downloadPng(name, code);
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="flex w-[46%] min-w-[400px] max-w-[660px] shrink-0 flex-col border-l border-line bg-cream max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-auto max-md:min-w-0 max-md:max-w-none">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0 text-clay">
          <path
            d="M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6M9 8.5a1 1 0 11-2 0 1 1 0 012 0z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="min-w-0 truncate text-[13px] font-medium">{name}</span>
        {live && <span className="shimmer shrink-0 text-[11px] text-clay-deep">AI 绘制中…</span>}
        <div className="flex-1" />
        <button
          onClick={() => download("png")}
          disabled={busy !== null || live || broken}
          title={failed ? "导出失败，请重试" : "下载为 PNG 图片"}
          className="shrink-0 rounded-lg bg-clay px-2.5 py-1.5 text-[12px] text-white hover:bg-clay-deep disabled:opacity-50"
        >
          {failed ? "导出失败" : busy === "png" ? "生成中…" : "下载 PNG"}
        </button>
        <button
          onClick={() => download("svg")}
          disabled={busy !== null || live || broken}
          title="下载为 SVG 矢量文件"
          className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-[12px] text-ink-soft hover:bg-sand disabled:opacity-50"
        >
          {busy === "svg" ? "…" : "SVG"}
        </button>
        <button
          onClick={onClose}
          title="收起图像面板"
          className="shrink-0 rounded-lg p-1 text-ink-soft hover:bg-sand"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-5">
        {url && !broken ? (
          <img
            src={url}
            alt={name}
            onError={() => setBrokenCode(safe)}
            className="max-h-full max-w-full rounded-[3px] bg-white shadow-[0_3px_20px_rgba(31,30,29,0.13)]"
          />
        ) : broken ? (
          <div className="max-w-[420px] rounded-xl border border-line bg-surface p-5 text-center text-[13px] text-ink-soft">
            这段 SVG 代码无法渲染，可以在对话里让模型重新画一张。
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-[13px] text-ink-soft">
            <span className="shimmer">AI 正在绘制…</span>
          </div>
        )}
      </div>
    </aside>
  );
}
