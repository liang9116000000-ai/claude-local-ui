import * as XLSX from "xlsx";
import { cellToNumber, parseSheets } from "./wordDoc.ts";

/**
 * CSV 表格 -> .xlsx 导出。整个模块（连同 xlsx 依赖）只在点击
 * 「下载 Excel」时被动态 import，避免拖大首屏包体。
 */

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r]/g, "").trim() || "表格";
}

/** 把单元格文本转成 xlsx 单元格值：数字文本转数值，其余保持字符串。 */
function coerceCell(text: string): string | number {
  return cellToNumber(text) ?? text;
}

/** 把 CSV 文本构建为工作簿（多工作表），供导出与测试使用。 */
export function buildWorkbook(csvText: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of parseSheets(csvText)) {
    const aoa = sheet.rows.map((row) => row.map(coerceCell));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 列宽按内容粗略自适应，避免打开后所有列挤在一起
    ws["!cols"] = computeColWidths(sheet.rows);
    // 同名工作表追加序号，避免 book_append_sheet 因重名抛错
    let title = sheet.name;
    let n = 2;
    while (used.has(title)) title = `${sheet.name}_${n++}`;
    used.add(title);
    XLSX.utils.book_append_sheet(wb, ws, title);
  }
  return wb;
}

/** 把 CSV 文本导出为 .xlsx 并触发浏览器下载。 */
export async function downloadXlsx(name: string, csvText: string): Promise<void> {
  const wb = buildWorkbook(csvText);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFileName(name)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function computeColWidths(rows: string[][]): { wch: number }[] {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths: { wch: number }[] = [];
  for (let c = 0; c < cols; c++) {
    let max = 4;
    for (const row of rows) {
      const cell = (row[c] ?? "").trim();
      // 中文字符按 2 个宽度计
      const w = [...cell].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
      if (w > max) max = w;
    }
    widths.push({ wch: Math.min(max + 2, 50) });
  }
  return widths;
}
