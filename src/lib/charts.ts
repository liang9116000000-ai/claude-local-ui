import { cellToNumber } from "./wordDoc.ts";

/** 图表配色（与应用的暖色调一致）。 */
export const CHART_COLORS = ["#d97757", "#7a9e7e", "#6b8cae", "#c9a227", "#9a6b9f"];

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  labels: string[];
  series: ChartSeries[];
}

/**
 * 从表格数据里提取图表数据：第一个非数值列做横轴标签，
 * 其余数值列各成一个系列（纯 1..n 递增的序号列会被跳过）。
 */
export function extractChartData(rows: string[][]): ChartData {
  if (rows.length < 2) return { labels: [], series: [] };
  const cols = Math.max(...rows.map((r) => r.length));
  const body = rows.slice(1);
  const hasNum = (c: number) => body.some((r) => cellToNumber(r[c] ?? "") !== null);
  let labelCol = 0;
  for (let c = 0; c < cols; c++) {
    if (!hasNum(c)) {
      labelCol = c;
      break;
    }
  }
  const labels = body.map((r, i) => (r[labelCol] ?? "").trim() || `第${i + 1}行`);
  const series: ChartSeries[] = [];
  for (let c = 0; c < cols; c++) {
    if (c === labelCol) continue;
    const values = body.map((r) => cellToNumber(r[c] ?? ""));
    if (!values.some((v) => v !== null)) continue;
    // 跳过纯 1..n 的序号列
    if (c === 0 && values.every((v, i) => v === i + 1)) continue;
    series.push({
      name: (rows[0]?.[c] ?? "").trim() || `列${c + 1}`,
      values: values.map((v) => v ?? 0),
    });
  }
  return { labels, series };
}
