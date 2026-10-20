import { useEffect, useMemo, useState } from "react";
import { parseSheets, stripChartDirective } from "../lib/wordDoc";
import type { ChartType } from "../lib/wordDoc";
import { extractChartData } from "../lib/charts";
import { BarChart, ChartLegend, LineChart, PieChart } from "./Charts";

function colName(i: number): string {
  let s = "";
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

const isNumeric = (t: string) => /^-?\d+(\.\d+)?%?$/.test(t.trim()) && t.trim() !== "";

const CHART_OPTIONS: { value: ChartType; label: string }[] = [
  { value: "bar", label: "柱状图" },
  { value: "line", label: "折线图" },
  { value: "pie", label: "饼图" },
];

const CHART_LABEL: Record<ChartType, string> = { bar: "柱状图", line: "折线图", pie: "饼图" };

/** 右侧的 Excel 表格面板：网格实时预览 + 导出 .xlsx。 */
export default function SheetPanel({ name, csv, live, onClose, onSave }: {
  name: string;
  /** XLS 标记内的原始文本（CSV，可含 "## 工作表名" 分节），允许流式半截 */
  csv: string;
  /** 模型正在流式改写表格 */
  live: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(csv);
  useEffect(() => { if (!editing) setDraft(csv); }, [csv, editing]);
  const [userChart, setUserChart] = useState<ChartType | null>(null);
  // 用户在这份内容上移除了图表（记录移除时的 csv；新内容到达后自动失效）
  const [removedAtCsv, setRemovedAtCsv] = useState<string | null>(null);
  // 模型指令（图表：柱状图）给出默认图表；用户手动选择后以手动为准
  const suggested = useMemo(() => stripChartDirective(csv).chart, [csv]);
  const { csv: bodyCsv } = useMemo(() => stripChartDirective(csv), [csv]);
  const sheets = useMemo(() => parseSheets(bodyCsv), [bodyCsv]);
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, sheets.length - 1)] ?? { name: "Sheet1", rows: [] };
  const chartType: "none" | ChartType =
    userChart ?? (removedAtCsv === csv ? "none" : suggested ?? "none");
  const chartData = useMemo(
    () => (chartType === "none" ? null : extractChartData(sheet.rows)),
    [chartType, sheet.rows],
  );

  async function download() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { downloadXlsx } = await import("../lib/xlsxExport");
      await downloadXlsx(name, csv);
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  const rows = sheet.rows;
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const dims = rows.length && cols ? `${rows.length} 行 × ${cols} 列` : "空表格";

  return (
    <aside className="flex w-[46%] min-w-[400px] max-w-[660px] shrink-0 flex-col border-l border-line bg-cream max-md:fixed max-md:inset-0 max-md:z-40 max-md:w-auto max-md:min-w-0 max-md:max-w-none">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0 text-clay">
          <path
            d="M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        <span className="min-w-0 truncate text-[13px] font-medium">{name}</span>
        <span className="shrink-0 text-[11px] text-ink-soft">{dims}</span>
        {live && <span className="shimmer shrink-0 text-[11px] text-clay-deep">AI 编辑中…</span>}
        <div className="flex-1" />
        <button onClick={() => editing ? (onSave(draft), setEditing(false)) : (setDraft(csv), setEditing(true))} disabled={live} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:bg-sand disabled:opacity-50">{editing ? "保存修改" : "编辑 CSV"}</button>
        {editing && <button onClick={() => { setDraft(csv); setEditing(false); }} className="shrink-0 rounded-lg px-2 py-1.5 text-[12px] text-ink-soft hover:bg-sand">取消</button>}
        <button
          onClick={download}
          disabled={busy || live}
          title={failed ? "导出失败，请重试" : "下载为 .xlsx 文件"}
          className="shrink-0 rounded-lg bg-clay px-2.5 py-1.5 text-[12px] text-white hover:bg-clay-deep disabled:opacity-50"
        >
          {failed ? "导出失败" : busy ? "生成中…" : "下载 Excel"}
        </button>
        <button
          onClick={onClose}
          title="收起表格面板"
          className="shrink-0 rounded-lg p-1 text-ink-soft hover:bg-sand"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {sheets.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-3 pt-2">
          {sheets.map((s, i) => (
            <button
              key={s.name + i}
              onClick={() => setActive(i)}
              className={`rounded-t-lg border border-b-0 px-3 py-1 text-[12px] ${
                i === Math.min(active, sheets.length - 1)
                  ? "border-line bg-cream text-ink"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-4 py-1.5">
        <span className="mr-1 text-[11px] text-ink-soft">图表</span>
        {chartType === "none" ? (
          CHART_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setUserChart(opt.value);
                setRemovedAtCsv(null);
              }}
              className="rounded-full px-2.5 py-0.5 text-[11px] text-ink-soft hover:bg-sand hover:text-ink"
            >
              {opt.label}
            </button>
          ))
        ) : (
          <>
            <span className="rounded-full bg-clay px-2.5 py-0.5 text-[11px] text-white">
              {CHART_LABEL[chartType]}
            </span>
            <button
              onClick={() => setRemovedAtCsv(csv)}
              title="移除图表"
              className="rounded-full p-1 text-ink-soft hover:bg-sand hover:text-ink"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </>
        )}
      </div>

      {chartType !== "none" && chartData && chartData.series.length > 0 ? (
        <div className="shrink-0 border-b border-line bg-white px-5 py-3">
          <div className="mx-auto max-w-[680px]">
            {chartType === "bar" ? (
              <BarChart data={chartData} />
            ) : chartType === "line" ? (
              <LineChart data={chartData} />
            ) : (
              <PieChart data={chartData} />
            )}
            {chartType !== "pie" ? <ChartLegend data={chartData} /> : null}
          </div>
        </div>
      ) : null}

      {editing ? <textarea aria-label="编辑表格 CSV" value={draft} onChange={(e) => setDraft(e.target.value)} className="m-4 min-h-48 flex-1 resize-y rounded-lg border border-line bg-white p-3 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-clay" /> : <div className="flex-1 overflow-auto p-4">
        <div className="sheet-grid mx-auto w-fit max-w-full overflow-auto rounded-[3px] bg-white shadow-[0_3px_20px_rgba(31,30,29,0.13)]">
          <table>
            <thead>
              <tr className="col-head">
                <th />
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c}>{colName(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  <th className="row-head">{r + 1}</th>
                  {Array.from({ length: cols }, (_, c) => {
                    const v = row[c] ?? "";
                    return (
                      <td key={c} className={isNumeric(v) ? "num" : ""}>
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
    </aside>
  );
}
