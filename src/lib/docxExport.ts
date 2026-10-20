import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { deriveDocName } from "./wordDoc.ts";

/**
 * Markdown 文档 -> .docx 导出。整个模块（连同 docx 依赖）只在我方点击
 * 「下载 Word」时被动态 import，避免拖大首屏包体。
 */

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\n\r]/g, "").trim() || "文档";
}

/** 把 Markdown 文档导出为 .docx 并触发浏览器下载。 */
export async function downloadDocx(name: string, md: string): Promise<void> {
  const blob = await mdToDocxBlob(md);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFileName(name)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 生成 Word 的中文字体：中文宋体 + 西文 Times New Roman，12pt。 */
const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "宋体" };
const HEADING = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

interface Inline {
  text: string;
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

const INLINE_RE =
  /(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;

function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: s.slice(last, i) });
    const t = m[0];
    if (t.startsWith("***")) out.push({ text: t.slice(3, -3), bold: true, italics: true });
    else if (t.startsWith("**") || t.startsWith("__")) out.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith("~~")) out.push({ text: t.slice(2, -2), strike: true });
    else if (t.startsWith("`")) out.push({ text: t.slice(1, -1), code: true });
    else if (t.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
      out.push(mm ? { text: mm[1], link: mm[2] } : { text: t });
    } else out.push({ text: t.slice(1, -1), italics: true });
    last = i + t.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

function runs(inl: Inline[], forceBold = false): TextRun[] {
  return inl.map((r) =>
    new TextRun({
      text: r.text,
      bold: forceBold || r.bold,
      italics: r.italics,
      strike: r.strike,
      font: r.code ? "Consolas" : FONT,
      color: r.link ? "0563C1" : undefined,
      underline: r.link ? {} : undefined,
      shading: r.code ? { type: ShadingType.CLEAR, fill: "F2F1EC" } : undefined,
    }),
  );
}

function splitRow(line: string): string[] {
  // 用私有区字符临时替换转义的 \|，拆完再还原
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\uE000");
  return t.split("|").map((c) => c.trim().replace(/\uE000/g, "|"));
}

function buildTable(rows: string[][]): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r, ri) =>
      new TableRow({
        tableHeader: ri === 0,
        children: Array.from({ length: cols }, (_, c) =>
          new TableCell({
            shading: ri === 0 ? { type: ShadingType.CLEAR, fill: "F2F1EC" } : undefined,
            width: { size: Math.floor(10000 / cols) / 100, type: WidthType.PERCENTAGE },
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: runs(parseInline(r[c] ?? ""), ri === 0),
                spacing: { after: 0, line: 280, lineRule: "auto" },
              }),
            ],
          }),
        ),
      }),
    ),
  });
}

const isTableRowLine = (line: string) => line.includes("|") && line.trim() !== "";
const isTableSeparator = (line: string) =>
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("-");

/** 逐行把 Markdown 解析成 docx 段落 / 表格。支持的语法以模型常输出的为准。 */
export function mdToDocxChildren(md: string): (Paragraph | Table)[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: (Paragraph | Table)[] = [];
  let i = 0;
  let olSeq = 0;
  let inOl = false;
  while (i < lines.length) {
    const line = lines[i];

    // ``` 代码块
    if (/^\s*```/.test(line)) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      buf.forEach((code, k) =>
        out.push(
          new Paragraph({
            children: [new TextRun({ text: code || " ", font: "Consolas", size: 19 })],
            shading: { type: ShadingType.CLEAR, fill: "F5F4EF" },
            spacing: { after: k === buf.length - 1 ? 160 : 0 },
          }),
        ),
      );
      continue;
    }

    // GFM 表格：当前行含 | 且下一行是分隔行
    if (isTableRowLine(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && isTableRowLine(lines[i]) && !/^\s*```/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(buildTable(rows));
      continue;
    }

    // 水平线
    if (/^\s{0,3}([-*_])(?:[ \t]*\1){2,}\s*$/.test(line)) {
      out.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BFBAB0", space: 1 } },
          spacing: { after: 200 },
          children: [],
        }),
      );
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (h) {
      const lv = h[1].length;
      out.push(
        new Paragraph({
          children: runs(parseInline(h[2])),
          heading: HEADING[lv - 1],
          spacing: { before: lv === 1 ? 120 : 200, after: 120 },
        }),
      );
      i++;
      continue;
    }

    // 引用块
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^[ \t]*>[ \t]?/, ""));
      for (const b of buf) {
        if (!b.trim()) continue;
        out.push(
          new Paragraph({
            children: runs(parseInline(b)),
            indent: { left: 420 },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: "C9C3B4", space: 12 } },
            spacing: { after: 120 },
          }),
        );
      }
      continue;
    }

    // 列表项（- / * / 1.），最多两级缩进；空行不打断列表，
    // 只有出现非列表内容块才视为新列表（有序列表换实例重新从 1 编号）
    const ul = /^(\s*)[-*+][ \t]+(.+)$/.exec(line);
    const ol = /^(\s*)(\d{1,3})[.)][ \t]+(.+)$/.exec(line);
    if (ul || ol) {
      const [, ws, body] = (ol ?? ul)!;
      const level = Math.min(2, Math.floor(ws.replace(/\t/g, "  ").length / 2));
      if (ol) {
        if (!inOl) olSeq++;
        inOl = true;
        out.push(
          new Paragraph({
            children: runs(parseInline(body)),
            numbering: { reference: "md-ol", level, instance: olSeq },
            spacing: { after: 80 },
          }),
        );
      } else {
        inOl = false;
        out.push(
          new Paragraph({
            children: runs(parseInline(body)),
            bullet: { level },
            spacing: { after: 80 },
          }),
        );
      }
      i++;
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    inOl = false;
    // 普通段落
    out.push(
      new Paragraph({
        children: runs(parseInline(line.trim())),
        spacing: { after: 120 },
      }),
    );
    i++;
  }
  return out;
}

/** Markdown 文档 → .docx Blob。 */
export async function mdToDocxBlob(md: string): Promise<Blob> {
  const doc = new Document({
    title: deriveDocName(md),
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 24, color: "26251F" },
          paragraph: { spacing: { line: 330, lineRule: "auto" } },
        },
        heading1: { run: { font: FONT, size: 36, bold: true, color: "000000" } },
        heading2: { run: { font: FONT, size: 30, bold: true, color: "000000" } },
        heading3: { run: { font: FONT, size: 26, bold: true, color: "000000" } },
        heading4: { run: { font: FONT, size: 24, bold: true, color: "000000" } },
        heading5: { run: { font: FONT, size: 24, bold: true, color: "3A382F" } },
        heading6: { run: { font: FONT, size: 24, italics: true, color: "3A382F" } },
      },
    },
    numbering: {
      config: [
        {
          reference: "md-ol",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: level === 0 ? "%1." : level === 1 ? "%2." : "%3.",
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [{ children: mdToDocxChildren(md) }],
  });
  return Packer.toBlob(doc);
}
