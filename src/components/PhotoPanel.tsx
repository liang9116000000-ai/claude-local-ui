/** 与 ChatGPT 生图一致的加载态：深色卡上整齐的点阵逐格闪烁（不伪造进度）。
 *  18 与 CSS 里 .image-dots 的网格列数保持一致。 */
const DOT_GRID = 18;
const LOADING_DOTS = Array.from({ length: DOT_GRID * DOT_GRID }, (_, i) => {
  const row = Math.floor(i / DOT_GRID);
  const col = i % DOT_GRID;
  // 沿对角线推进的相位：亮点像一道波纹扫过点阵
  return { delay: ((row + col) * 0.075) % 2.6 };
});

function ImageGenerationLoader() {
  return (
    <div
      className="flex w-full max-w-[480px] flex-col items-center gap-4"
      role="status"
      aria-live="polite"
      aria-label="正在生成图像"
    >
      <div className="image-skeleton w-full" aria-hidden="true">
        <div className="image-dots">
          {LOADING_DOTS.map((d, i) => (
            <i key={i} className="image-dot" style={{ animationDelay: `-${d.delay.toFixed(3)}s` }} />
          ))}
        </div>
      </div>
      <p className="shimmer text-[13px]">正在创建图像…</p>
    </div>
  );
}

/** 右侧的 AI 绘图面板：显示本地绘图模型（FLUX.2 klein）生成的图片，可重画 / 下载。 */
export default function PhotoPanel({ name, prompt, src, live, onRegenerate, onClose }: {
  name: string;
  /** 绘图用的英文提示词 */
  prompt: string;
  /** 图片 data URL；页面刷新后为空，可用「重新生成」重画 */
  src?: string;
  /** 正在重新绘制 */
  live: boolean;
  onRegenerate: () => void;
  onClose: () => void;
}) {

  function download() {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = `${name.replace(/[\\/:*?"<>|\n\r]/g, "").trim() || "图像"}.png`;
    a.click();
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
        {live && <span className="shimmer shrink-0 text-[11px] text-clay-deep">正在创作</span>}
        <div className="flex-1" />
        <button
          onClick={onRegenerate}
          disabled={live}
          title="用同样的提示词再画一张（随机效果不同）"
          className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-[12px] text-ink-soft hover:bg-sand disabled:opacity-50"
        >
          重画一张
        </button>
        <button
          onClick={download}
          disabled={!src}
          title={src ? "下载 PNG 图片" : "还没有图片，先重新生成"}
          className="shrink-0 rounded-lg bg-clay px-2.5 py-1.5 text-[12px] text-white hover:bg-clay-deep disabled:opacity-50"
        >
          下载 PNG
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
        {live ? (
          <ImageGenerationLoader />
        ) : src ? (
          <img
            src={src}
            alt={name}
            className="image-reveal max-h-full max-w-full rounded-xl bg-white shadow-[0_3px_20px_rgba(31,30,29,0.13)]"
          />
        ) : (
          <div className="flex max-w-[380px] flex-col items-center gap-3 rounded-xl border border-line bg-surface p-6 text-center">
            <span className="text-[13px] text-ink-soft">
              图片不随页面刷新保留，点「重画一张」用下面的提示词重新生成。
            </span>
            <code className="max-h-24 overflow-y-auto rounded-lg bg-sand px-3 py-2 text-left text-[11px] leading-relaxed text-ink-soft">
              {prompt}
            </code>
            <button
              onClick={onRegenerate}
              disabled={live}
              className="rounded-lg bg-clay px-3 py-1.5 text-[12px] text-white hover:bg-clay-deep disabled:opacity-50"
            >
              {live ? "绘制中…" : "重新生成"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
