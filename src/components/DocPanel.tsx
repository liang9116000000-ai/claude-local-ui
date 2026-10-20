import { useEffect, useState } from "react";
import Markdown from "./Markdown";

/** 右侧的 Word 文档面板：A4 纸样式实时预览 + 导出 .docx。 */
export default function DocPanel({ name, md, live, onClose, onSave }: {
  name: string;
  md: string;
  /** 模型正在流式改写文档 */
  live: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(md);
  useEffect(() => { if (!editing) setDraft(md); }, [md, editing]);

  async function download() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { downloadDocx } = await import("../lib/docxExport");
      await downloadDocx(name, md);
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  const chars = md.replace(/\s/g, "").length;

  return (
    <aside className="flex w-[46%] min-w-[400px] max-w-[660px] shrink-0 flex-col border-l border-line bg-cream max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-auto max-md:min-w-0 max-md:max-w-none">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0 text-clay">
          <path
            d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zm0 0v5h5M9 13h6M9 17h6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="min-w-0 truncate text-[13px] font-medium">{name}</span>
        <span className="shrink-0 text-[11px] text-ink-soft">{chars} 字</span>
        {live && <span className="shimmer shrink-0 text-[11px] text-clay-deep">AI 编辑中…</span>}
        <div className="flex-1" />
        <button onClick={() => editing ? (onSave(draft), setEditing(false)) : (setDraft(md), setEditing(true))} disabled={live} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-sand disabled:opacity-50">{editing ? "保存修改" : "编辑"}</button>
        {editing && <button onClick={() => { setDraft(md); setEditing(false); }} className="shrink-0 rounded-lg px-2 py-1.5 text-[12px] text-ink-soft hover:bg-sand">取消</button>}
        <button
          onClick={download}
          disabled={busy || live}
          title={failed ? "导出失败，请重试" : "下载为 .docx 文件"}
          className="shrink-0 rounded-lg bg-clay px-2.5 py-1.5 text-[12px] text-white hover:bg-clay-deep disabled:opacity-50"
        >
          {failed ? "导出失败" : busy ? "生成中…" : "下载 Word"}
        </button>
        <button
          onClick={onClose}
          title="收起文档面板"
          className="shrink-0 rounded-lg p-1 text-ink-soft hover:bg-sand"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {editing ? <textarea aria-label="编辑文档 Markdown" value={draft} onChange={(e) => setDraft(e.target.value)} className="mx-auto block min-h-[860px] w-full max-w-[680px] resize-y rounded-[3px] border border-line bg-white px-8 py-8 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-clay" /> : <div className="doc-page mx-auto min-h-[860px] max-w-[680px] rounded-[3px] px-14 py-16 shadow-[0_3px_20px_rgba(31,30,29,0.13)]"><Markdown text={md} /></div>}
      </div>
    </aside>
  );
}
