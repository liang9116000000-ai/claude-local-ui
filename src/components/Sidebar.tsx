import { useEffect, useMemo, useRef, useState } from "react";
import type { Conv } from "../types";
import { MODEL_DISPLAY_NAME } from "../lib/model";

export default function Sidebar({ convs, activeId, open, onSelect, onSelectResult, onNew, onDelete, onClose, onRename, onExportBackup, onImportBackup, backupNotice }: {
  convs: Conv[];
  activeId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onSelectResult: (id: string, messageIndex: number) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  backupNotice: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("claude-focus-search", focus);
    return () => window.removeEventListener("claude-focus-search", focus);
  }, []);
  const filteredConvs = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return convs;
    return convs.filter((c) => c.title.toLocaleLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLocaleLowerCase().includes(q) || m.attachments?.some((a) => a.name.toLocaleLowerCase().includes(q) || a.text.toLocaleLowerCase().includes(q))) ||
      c.artifact?.name.toLocaleLowerCase().includes(q));
  }, [convs, query]);
  const matchingMessages = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return new Map(filteredConvs.map((c) => [c.id, q ? c.messages.flatMap((m, i) => m.content.toLocaleLowerCase().includes(q) || m.attachments?.some((a) => a.name.toLocaleLowerCase().includes(q) || a.text.toLocaleLowerCase().includes(q)) ? [i] : []) : []]));
  }, [filteredConvs, query]);

  function startRename(id: string, title: string) {
    setEditingId(id);
    setDraftTitle(title);
  }

  function commitRename(id: string) {
    const t = draftTitle.trim();
    if (t) onRename(id, t.slice(0, 40));
    setEditingId(null);
    setDraftTitle("");
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-10 bg-black/20 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-20 flex w-[260px] flex-col bg-sand transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="app-sidebar-brand flex items-center gap-2 px-4 pt-4 pb-2">
          <span className="brand-mark" aria-hidden="true">知</span>
          <span className="font-display text-[15px] font-semibold">知序 AI</span>
        </div>

        <button
          onClick={onNew}
          className="sidebar-new-chat mx-3 mt-2 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[14px] font-medium text-clay-deep hover:bg-sand-deep"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          新对话
        </button>

        <div className="sidebar-search mx-3 mt-2">
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }} placeholder="搜索对话… Ctrl+K" aria-label="搜索对话" className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-ink-soft focus:border-[#c9c3b4]" />
        </div>

        <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-3">
          {convs.length === 0 && (
            <p className="px-3 pt-6 text-[13px] leading-relaxed text-ink-soft">
              还没有对话。<br />发送第一条消息开始。
            </p>
          )}
          {convs.length > 0 && filteredConvs.length === 0 && <p className="px-3 pt-5 text-[13px] text-ink-soft">没有找到匹配的对话。</p>}
          {filteredConvs.map((c) => (
            <div key={c.id}>
            <div
            className={`sidebar-conversation group flex items-center rounded-lg px-3 py-2 text-[13.5px] ${
                c.id === activeId ? "bg-sand-deep" : "hover:bg-sand-deep/60"
              }`}
            >
              {editingId === c.id ? (
                <input
                  value={draftTitle}
                  autoFocus
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(c.id);
                    else if (e.key === "Escape") {
                      setEditingId(null);
                      setDraftTitle("");
                    }
                  }}
                  className="w-full rounded border border-line bg-surface px-1.5 py-0.5 text-[13.5px] outline-none"
                />
              ) : (
                <button
                  className="flex-1 truncate text-left"
                  onClick={() => onSelect(c.id)}
                  onDoubleClick={() => startRename(c.id, c.title)}
                  title={`${c.title || "新对话"}（双击重命名）`}
                >
                  {c.title || "新对话"}
                </button>
              )}
              {editingId !== c.id && (
                <button
                  className="hidden text-ink-soft hover:text-clay-deep group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  title="删除对话"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
            {query.trim() && (matchingMessages.get(c.id)?.length ?? 0) > 0 && (
              <div className="-mt-1 mb-1 space-y-0.5 px-2 pb-1">
                {matchingMessages.get(c.id)!.slice(0, 3).map((messageIndex) => {
                  const message = c.messages[messageIndex];
                  const q = query.trim();
                  const body = message.content.toLocaleLowerCase().includes(q.toLocaleLowerCase()) ? message.content : (message.attachments?.find((a) => a.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()) || a.text.toLocaleLowerCase().includes(q.toLocaleLowerCase()))?.text ?? message.content);
                  const at = body.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
                  const start = Math.max(0, at - 22);
                  const snippet = body.slice(start, Math.min(body.length, at + q.length + 48)).replace(/\s+/g, " ");
                  return <button key={messageIndex} onClick={() => onSelectResult(c.id, messageIndex)} className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-ink-soft hover:bg-surface" title="跳转到这条消息">{message.role === "user" ? "你：" : "助手："}{start > 0 ? "…" : ""}{snippet}{start + snippet.length < body.length ? "…" : ""}</button>;
                })}
              </div>
            )}
            {query.trim() && (matchingMessages.get(c.id)?.length ?? 0) === 0 && (
              <div className="-mt-1 mb-1 px-2 pb-1">
                <button onClick={() => onSelect(c.id)} className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-ink-soft hover:bg-surface" title="打开此对话">打开此对话 · 标题或产物名称匹配</button>
              </div>
            )}
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <div className="mb-3 flex gap-2">
            <button onClick={onExportBackup} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[11px] text-ink-soft hover:bg-surface" title="导出全部会话和产物">导出备份</button>
            <button onClick={onImportBackup} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[11px] text-ink-soft hover:bg-surface" title="从 JSON 备份恢复会话">导入备份</button>
          </div>
          {backupNotice && <p role="status" className="mb-2 text-[11px] leading-relaxed text-ink-soft">{backupNotice}</p>}
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-clay text-[11px] font-semibold text-white">
                知序
            </div>
            <div className="text-[12px] leading-tight">
              <div className="font-medium" title={MODEL_DISPLAY_NAME}>知序 AI · Qwen3.5-4B</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
