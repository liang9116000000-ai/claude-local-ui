import { CHART_COLORS, type ChartData } from "../lib/charts";

const fmtTick = (v: number) => {
  const n = Math.abs(v) >= 1000 ? Math.round(v / 100) / 10 + "k" : String(Math.round(v * 10) / 10);
  return n;
};

const trunc = (s: string, n = 8) => (s.length > n ? s.slice(0, n) + "…" : s);

interface Props {
  data: ChartData;
}

/** 柱状图（多系列分组）。 */
export function BarChart({ data }: Props) {
  const W = 640;
  const H = 280;
  const pad = { l: 52, r: 14, t: 16, b: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const all = data.series.flatMap((s) => s.values);
  if (!all.length) return null;
  const max = Math.max(...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const yOf = (v: number) => pad.t + ih - ((v - min) / span) * ih;
  const groupW = iw / Math.max(1, data.labels.length);
  const barW = Math.max(3, (groupW * 0.72) / data.series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {Array.from({ length: 5 }, (_, i) => {
        const v = min + (span * i) / 4;
        const y = yOf(v);
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#e8e4d9" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#8f8b80">
              {fmtTick(v)}
            </text>
          </g>
        );
      })}
      {data.labels.map((label, i) => (
        <g key={i}>
          {data.series.map((s, si) => {
            const x = pad.l + i * groupW + groupW * 0.14 + si * barW;
            const y = yOf(s.values[i] ?? 0);
            return (
              <rect
                key={si}
                x={x}
                y={Math.min(y, yOf(0))}
                width={Math.max(1, barW - 1.5)}
                height={Math.max(0.5, Math.abs(yOf(0) - y))}
                fill={CHART_COLORS[si % CHART_COLORS.length]}
                rx={1.5}
              >
                <title>{`${label} · ${s.name}: ${s.values[i]}`}</title>
              </rect>
            );
          })}
          <text
            x={pad.l + i * groupW + groupW / 2}
            y={H - pad.b + 15}
            textAnchor="middle"
            fontSize={10.5}
            fill="#57544e"
          >
            {trunc(label)}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 折线图（多系列）。 */
export function LineChart({ data }: Props) {
  const W = 640;
  const H = 280;
  const pad = { l: 52, r: 18, t: 16, b: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const all = data.series.flatMap((s) => s.values);
  if (!all.length) return null;
  const max = Math.max(...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const yOf = (v: number) => pad.t + ih - ((v - min) / span) * ih;
  const step = iw / Math.max(1, data.labels.length - (data.labels.length > 1 ? 1 : 0));
  const xOf = (i: number) => pad.l + (data.labels.length > 1 ? i * step : iw / 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {Array.from({ length: 5 }, (_, i) => {
        const v = min + (span * i) / 4;
        const y = yOf(v);
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#e8e4d9" strokeWidth={1} />
            <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#8f8b80">
              {fmtTick(v)}
            </text>
          </g>
        );
      })}
      {data.series.map((s, si) => (
        <g key={si}>
          <polyline
            points={s.values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ")}
            fill="none"
            stroke={CHART_COLORS[si % CHART_COLORS.length]}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {s.values.map((v, i) => (
            <circle key={i} cx={xOf(i)} cy={yOf(v)} r={3} fill={CHART_COLORS[si % CHART_COLORS.length]}>
              <title>{`${data.labels[i]} · ${s.name}: ${v}`}</title>
            </circle>
          ))}
        </g>
      ))}
      {data.labels.map((label, i) => (
        <text key={i} x={xOf(i)} y={H - pad.b + 15} textAnchor="middle" fontSize={10.5} fill="#57544e">
          {trunc(label)}
        </text>
      ))}
    </svg>
  );
}

/** 饼图（取第一个数值系列），带图例与占比。 */
export function PieChart({ data }: Props) {
  const s = data.series[0];
  if (!s || !s.values.length) return null;
  const total = s.values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const cx = 125;
  const cy = 125;
  const r = 98;
  // 用 reduce 携带累计角度，避免渲染期重赋值外层变量
  const slices = s.values
    .reduce<{ acc: number; items: { i: number; v: number; frac: number; path: string; color: string }[] }>(
      (state, v, i) => {
        const frac = Math.max(0, v) / total;
        const a1 = state.acc;
        const a2 = a1 + frac * Math.PI * 2;
        const large = a2 - a1 > Math.PI ? 1 : 0;
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        const x2 = cx + r * Math.cos(a2);
        const y2 = cy + r * Math.sin(a2);
        const path =
          frac >= 0.9999
            ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`
            : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
        return {
          acc: a2,
          items: [...state.items, { i, v, frac, path, color: CHART_COLORS[i % CHART_COLORS.length] }],
        };
      },
      { acc: -Math.PI / 2, items: [] },
    )
    .items;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 250 250" className="h-[220px] w-[220px] shrink-0">
        {slices.map((sl) => (
          <path key={sl.i} d={sl.path} fill={sl.color} stroke="#ffffff" strokeWidth={1.5}>
            <title>{`${data.labels[sl.i]}: ${sl.v}（${(sl.frac * 100).toFixed(1)}%）`}</title>
          </path>
        ))}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-[12px]">
        {slices.map((sl) => (
          <li key={sl.i} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: sl.color }}
            />
            <span className="min-w-0 flex-1 truncate" title={data.labels[sl.i]}>
              {data.labels[sl.i]}
            </span>
            <span className="shrink-0 text-ink-soft">
              {sl.v} · {(sl.frac * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 图例（多系列柱状/折线图用）。 */
export function ChartLegend({ data }: Props) {
  if (data.series.length < 2) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-soft">
      {data.series.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
          />
          {s.name}
        </span>
      ))}
    </div>
  );
}
