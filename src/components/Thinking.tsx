import { useEffect, useState } from "react";
import Markdown from "./Markdown";

/** Claude-style collapsible reasoning block.
 *
 * While the answer is still streaming, the block starts expanded and shows
 * the live reasoning trace dimmed; once the answer starts it collapses to a
 * one-line summary the user can click to re-open.
 */
export default function Thinking({ text, seconds, live }: {
  text: string;
  seconds?: number;
  live: boolean;
}) {
  const [open, setOpen] = useState(live);
  useEffect(() => {
    if (!live) setOpen(false);
  }, [live]);

  const chars = text.length;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[13px] text-ink-soft hover:text-ink"
      >
        {live ? (
          <span className="shimmer font-medium">思考中…</span>
        ) : (
          <span>
            已深度思考（{seconds ?? "?"} 秒 · {chars} 字）
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl bg-sand/70 px-3 py-2 text-[13px] leading-relaxed text-ink-soft [&_*]:!text-[13px] [&_*]:!text-ink-soft">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}
