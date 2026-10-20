import { sanitizeSvg } from "./wordDoc.ts";

/**
 * SVG 图像导出（.svg 源文件 / .png 位图）。整个模块只在点击下载按钮时
 * 被动态 import，避免拖大首屏包体。
 */

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r]/g, "").trim() || "图像";
}

function triggerDownload(blob: Blob, name: string, ext: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFileName(name)}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 下载 .svg 源文件。 */
export async function downloadSvg(name: string, code: string): Promise<void> {
  const blob = new Blob([sanitizeSvg(code)], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, name, "svg");
}

/** SVG -> PNG（2 倍尺寸渲染，更清晰）；转换失败时抛错。 */
export async function svgToPngBlob(code: string): Promise<Blob> {
  const clean = sanitizeSvg(code);
  const blob = new Blob([clean], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG 解析失败"));
      img.src = url;
    });
    // SVG 没写 width/height 时 naturalWidth 可能为 0，兜底 800x600
    const w = img.naturalWidth || 800;
    const h = img.naturalHeight || 600;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 不可用");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!out) throw new Error("PNG 编码失败");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 下载 .png 位图。 */
export async function downloadPng(name: string, code: string): Promise<void> {
  const blob = await svgToPngBlob(code);
  triggerDownload(blob, name, "png");
}
