import { memo, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";

/** Chrome / Edge 的语音识别（webkit 前缀），TS 里没有统一类型时用最小接口 */
interface SpeechRecLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechCtor(): (new () => SpeechRecLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecLike; webkitSpeechRecognition?: new () => SpeechRecLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function Composer({ disabled, onSend, onStop }: {
  disabled: boolean;
  onSend: (text: string, attachments?: { name: string; text: string }[]) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [attachments, setAttachments] = useState<{ name: string; text: string }[]>([]);
  const [fileError, setFileError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<SpeechRecLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef("");
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const speechReady = typeof window !== "undefined" && !!getSpeechCtor();

  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener("claude-focus-composer", focus);
    return () => {
      window.removeEventListener("claude-focus-composer", focus);
    };
  }, []);

  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    setFileError("");
    const next: { name: string; text: string }[] = [];
    try {
      for (const file of Array.from(files)) {
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8 MB。`);
        const ext = file.name.split(".").pop()?.toLowerCase();
        let content = "";
        if (["txt", "md", "csv", "tsv", "json", "xml", "html", "log"].includes(ext || "")) {
          content = await file.text();
        } else if (["xlsx", "xls"].includes(ext || "")) {
          const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
          content = workbook.SheetNames.map((name) => `## ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join("\n\n");
        } else {
          throw new Error(`${file.name} 格式暂不支持，请使用 TXT、Markdown、CSV、JSON 或 Excel。`);
        }
        next.push({ name: file.name, text: content });
      }
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "读取附件失败");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function toggleVoice() {
    if (!speechReady) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) final += t;
        else interim += t;
      }
      const base = textRef.current.endsWith(" ") || !textRef.current ? textRef.current : `${textRef.current} `;
      setText(base + (final || interim));
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  useEffect(() => () => recRef.current?.stop(), []);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [text]);

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t, attachments);
    setText("");
    setAttachments([]);
  }

  return (
    <div className="composer-shell px-4 pb-4 pt-2">
      <div className="composer-inner mx-auto max-w-3xl">
        <div className="relative">
          <input ref={fileRef} type="file" multiple accept=".txt,.md,.csv,.tsv,.json,.xml,.html,.log,.xlsx,.xls" className="hidden" onChange={(e) => void readFiles(e.target.files)} />
          <div className="composer-box rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-[0_2px_10px_rgba(31,30,29,0.04)] focus-within:border-[#c9c3b4]">
            {attachments.length > 0 && (
              <div className="composer-attachments" aria-label="已添加的附件">
                {attachments.map((file, i) => (
                  <span key={`${file.name}-${i}`} className="composer-attachment" title={file.name}>
                    <span className="composer-attachment-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M7 3.75h7l4.25 4.5v12H7a2 2 0 01-2-2v-12a2.5 2.5 0 012-2.5zM14 4v5h4M8.5 13h7M8.5 16.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="composer-attachment-name">{file.name}</span>
                    <button onClick={() => setAttachments((items) => items.filter((_, n) => n !== i))} aria-label={`移除 ${file.name}`} title="移除附件" className="composer-attachment-remove">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-controls">
              <button onClick={() => fileRef.current?.click()} disabled={disabled} title="添加附件" className="composer-tool-button" aria-label="添加附件">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              {speechReady ? (
                <button
                  onClick={toggleVoice}
                  disabled={disabled}
                  title={listening ? "停止语音输入（中文）" : "语音输入（中文）"}
                  aria-label={listening ? "停止语音输入" : "语音输入"}
                  className={`composer-tool-button transition-colors disabled:opacity-40 ${
                    listening ? "bg-clay text-white animate-pulse" : "text-ink-soft hover:bg-sand hover:text-ink"
                  }`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
                    <path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              ) : null}
              <textarea
                ref={ref}
                rows={1}
                value={text}
                aria-label="消息输入框"
                placeholder={listening ? "正在听，请说话…" : "向知序 AI 发送消息"}
                className="composer-textarea max-h-[200px] flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-[#a8a49a]"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {disabled ? (
                <button onClick={onStop} title="停止生成" aria-label="停止生成" className="composer-send-button bg-ink text-cream">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                </button>
              ) : (
                <button onClick={submit} disabled={!text.trim()} title="发送 (Enter)" aria-label="发送消息" className="composer-send-button bg-clay text-white disabled:cursor-not-allowed disabled:opacity-30 hover:bg-clay-deep">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        {fileError && <p role="alert" className="mt-1 text-[11px] text-clay-deep">{fileError}</p>}
      </div>
    </div>
  );
}

export default memo(Composer);
