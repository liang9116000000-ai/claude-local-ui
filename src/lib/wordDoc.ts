import type { Artifact } from "../types";

/**
 * 文档 / 表格 / 图像模式约定：模型把完整内容放在成对标记之间输出，标记之外
 * 只写一两句说明。前端流式解析标记，右侧面板实时刷新并支持导出：
 * - Word 文档：<<<DOC ... DOC>>>，Markdown 格式（导出见 docxExport.ts）
 * - Excel 表格：<<<XLS ... XLS>>>，CSV 格式，"## 工作表名" 分节（导出见 xlsxExport.ts）
 * - 矢量图像：<<<SVG ... SVG>>>，一段自包含的 <svg> 代码（导出见 svgExport.ts）
 */

export const DOC_OPEN = "<<<DOC";
export const DOC_CLOSE = "DOC>>>";
export const XLS_OPEN = "<<<XLS";
export const XLS_CLOSE = "XLS>>>";
export const SVG_OPEN = "<<<SVG";
export const SVG_CLOSE = "SVG>>>";

const COMMON_RULES = (what: string) =>
  `修改时输出修改后的完整${what}：不得省略、不得用省略号或「其余保持不变」代替，未提及的部分原样保留。`;

const WORD_RULES = [
  `1. 文档全文必须完整放在 ${DOC_OPEN} 和 ${DOC_CLOSE} 两个独立标记之间，标记必须成对出现。`,
  "2. 文档用 Markdown 排版：标题用 #/##/###，列表用 - 或 1.，表格用 | 分隔；正文不要用代码块包裹。",
  `3. 标记之外只允许写一两句话说明你做了什么修改。${COMMON_RULES("文档")}`,
  "4. 文档里不要出现这对标记本身，也不要解释这些规则。",
].join("\n");

const XLS_RULES = [
  `1. 表格数据必须完整放在 ${XLS_OPEN} 和 ${XLS_CLOSE} 两个独立标记之间，标记必须成对出现。`,
  "2. 数据用 CSV 格式：第一行是表头，英文逗号分隔；单元格内含逗号或换行时，用英文双引号把整个单元格包裹；数字直接写数字，不要加单位或千分位逗号。",
  '3. 只有一个工作表时，直接输出表头和数据行，不要输出任何 "##" 行。确实需要多个工作表时，才在每张表的第一行前加一行 "## 实际表名"（如 ## 一月、## 二月），不要照抄"工作表名"这三个字。',
  `4. 标记之外只允许写一两句话说明你做了什么修改。${COMMON_RULES("表格数据")}`,
  "5. 数据里不要出现这对标记本身，也不要用代码块包裹，最后一行数据输出完就结束。",
  "6. 只有用户明确要求配图表时，才在数据第一行之前单独加一行「图表：柱状图」（三选一：柱状图 / 折线图 / 饼图）；用户没要求图表时，绝对不要输出「图表：」行。",
].join("\n");

const SVG_RULES = [
  `1. 图像必须是完整的 SVG 代码，放在 ${SVG_OPEN} 和 ${SVG_CLOSE} 两个独立标记之间，标记必须成对出现。`,
  "2. 只输出一个 <svg> 根元素：必须带 viewBox 和 width/height，先画一个底色矩形铺满画布。",
  "3. 所有文字用 <text> 写（中文直接写），形状用 rect/circle/ellipse/line/path/polygon；可以加简单的渐变和透明度。",
  "4. 禁止引用外部图片、字体和网络资源；禁止 <script>、<foreignObject> 和 onclick 等事件属性。",
  `5. 标记之外只允许写一两句话说明你画了什么。${COMMON_RULES("图像")}`,
  "6. 用户没要求画图时，绝对不要输出这对标记。",
].join("\n");

/**
 * 系统提示一律只给「单一类型」的规则：实测 4B 模型对单路径规则合规率接近
 * 100%，合并"二选一"规则会掉到六成。客户端用 hasTableIntent 路由。
 */

/** 系统提示：新建 Word 文档（已实测稳定）。 */
export const DOC_HINT =
  "【文档输出规则，必须遵守】凡是为用户写「成文的内容」——包括但不限于：情书、情信、感谢信、请假条、检讨书、保证书、邀请函、邮件、合同、协议、通知、公告、总结、计划、方案、简历、文章、作文、日记、演讲稿、发言稿等——" +
  `都必须把全文放在 ${DOC_OPEN} 和 ${DOC_CLOSE} 两个独立标记之间输出，用 Markdown 排版（标题 #、列表、表格），标记之外只允许写一两句话说明。` +
  "不要用代码块包裹文档，不要省略内容，文档内不要出现这对标记本身。" +
  "写代码、编程、算法实现、调试这类技术问答不算成文内容：直接正常回答，代码放 Markdown 代码块里，不要输出文档标记。" +
  "只有不需要成文的简单问答或闲聊，才正常回答并忽略本规则。";

/** Give fiction requests a deliberate long-form target instead of short generic prose. */
export const FICTION_HINT =
  `【小说创作规则】用户要创作小说、故事或续写章节时，直接写正文，不要用大纲、梗概或创作建议代替。没有指定字数时，正文目标约 2000–3000 个汉字，完成一个有起承转合的完整章节；用户明确要求短篇、片段或指定字数时，严格按用户要求。不要为省字数跳过场景、人物行动和关键转折，不要在正文未结束时提前总结或询问是否继续。小说全文用 Markdown 排版，并完整放在 ${DOC_OPEN} 和 ${DOC_CLOSE} 两个独立标记之间；标记之外只写一两句说明，不要输出代码块。`;

/** Only route fiction writing and continuation requests to the long-form preset. */
export function hasFictionIntent(text: string): boolean {
  if (/大纲|梗概|提纲|人物设定|世界观设定|简介|书评|分析小说/u.test(text)) return false;
  return /(?:写|创作|续写|接着写|继续写|编写|生成|润色).{0,20}(?:小说|故事|章节|网文|短篇|长篇)|(?:小说|故事|章节|网文).{0,20}(?:续写|继续|下一章|写下去|正文)|(?:短篇小说|长篇小说|小说续写|故事续写)/u.test(text);
}

/** 系统提示：新建 Excel 表格。 */
export const XLS_HINT =
  "【表格输出规则，必须遵守】凡是为用户做「表格数据」——包括但不限于：成绩单、预算表、收支表、清单、统计表、花名册、名单、账目、报表、排名表、课程表、日程表等——" +
  `都必须把数据放在 ${XLS_OPEN} 和 ${XLS_CLOSE} 两个独立标记之间输出，CSV 格式：第一行是表头，英文逗号分隔，含逗号或换行的单元格用英文双引号包裹，多个工作表用一行 "## 实际表名" 分节，数字直接写数字不要加单位。` +
  "用户要求配图表时，在数据第一行之前单独加一行「图表：柱状图」（三选一：柱状图 / 折线图 / 饼图）；用户没要求图表时，绝对不要输出「图表：」行。" +
  "标记之外只允许写一两句话说明。不要用代码块包裹，不要省略内容。只有不做表格时才正常回答并忽略本规则。";

/** 系统提示：新建矢量图像。 */
export const SVG_HINT =
  "【图像绘制规则，必须遵守】凡是为用户「画图 / 生成图像」——包括但不限于：示意图、流程图、简笔画、插画、图标、logo、布局图、壁纸图案等——" +
  `都必须把完整的 SVG 代码放在 ${SVG_OPEN} 和 ${SVG_CLOSE} 两个独立标记之间输出：只输出一个 <svg> 根元素（带 viewBox 和 width/height），先画一个底色矩形，文字用 <text>（中文直接写），形状用 rect/circle/line/path/polygon，可以加渐变；禁止引用外部资源和 <script>。` +
  "画面必须用 SVG 图形元素画出来，不要用文字描述画面，也不要用字符拼画。" +
  "标记之外只允许写一两句话说明你画了什么。用户没要求画图时，正常回答并忽略本规则。";

/** 用户消息命中这些词时走表格规则，否则默认走文档规则。 */
const TABLE_WORDS = [
  "表格", "成绩", "清单", "账目", "账单", "预算", "统计", "花名册", "名单",
  "收支", "明细", "报表", "排名", "排行", "名次", "工资", "库存", "课程表",
  "日程表", "值日表", "考勤", "excel", "Excel", "xlsx", "csv", "CSV",
];

export function hasTableIntent(text: string): boolean {
  return TABLE_WORDS.some((w) => text.includes(w));
}

/** 系统提示：普通问答 / 代码请求（明确禁止产物标记）。 */
export const CODE_HINT =
  "【回答规则】这是普通问答，用户要的是代码或技术解答，不是文档、表格或图像。" +
  "直接正常回答：简要说明思路，然后把完整代码放在 Markdown 代码块（```语言名）里。" +
  `绝对不要输出 ${DOC_OPEN}、${XLS_OPEN}、${SVG_OPEN} 任何一对产物标记，也不要写成文内容。`;

/** 代码类请求的信号词（在用户消息里匹配）。 */
const CODE_WORDS = [
  "代码", "编程", "程序", "脚本", "函数", "算法", "源码", "调试", "爬虫",
  "正则", "接口", "写个网页", "写个页面", "面向对象", "数据库",
  "python", "java", "javascript", "typescript", "node", "vue", "react",
  "c++", "rust", "golang", "sql", "mysql", "sqlite", "html", "css", "bash",
];

/** 明确要文档的信号词：出现时即使提到"代码"也走文档规则。 */
const DOC_WORDS = [
  "文档", "文章", "简历", "论文", "报告", "作文", "请假条", "检讨书",
  "保证书", "邀请函", "邮件", "合同", "协议", "通知", "公告", "总结",
  "方案", "演讲稿", "情书", "日记",
];

/** 用户是不是在要代码/技术解答（且不是"在文档里加代码"这类文档请求）。 */
export function hasCodeIntent(text: string): boolean {
  if (DOC_WORDS.some((w) => text.includes(w))) return false;
  const t = text.toLowerCase();
  return CODE_WORDS.some((w) => t.includes(w));
}

/** 模型不守规矩、把代码回答包进 DOC 标记时，去掉标记把内容还给聊天流。 */
export function stripDocMarkers(text: string): string {
  return text
    .replace(/^[ \t]*(?:<<<DOC|DOC>>>)[ \t]*\r?\n?/gm, "")
    .replace(/<<<DOC|DOC>>>/g, "");
}

/** 系统提示：已有 Word 文档在编辑。 */
export function docPrompt(doc: Extract<Artifact, { kind: "word" }>): string {
  return (
    `【Word 文档模式】你正在帮用户修改一份 Word 文档，请严格遵守：\n${WORD_RULES}\n\n` +
    `【当前文档「${doc.name}」内容（Markdown）】\n` +
    `${DOC_OPEN}\n${doc.md}\n${DOC_CLOSE}\n` +
    `上面这份就是文档的最新内容，用户的新要求是对它的修改意见。无论用户要求改什么，你都必须在 ${DOC_OPEN} 和 ${DOC_CLOSE} 之间输出修改后的完整文档，不要只输出修改的部分。`
  );
}

/** 系统提示：已有 Excel 表格在编辑。 */
export function xlsPrompt(sheet: Extract<Artifact, { kind: "excel" }>): string {
  return (
    `【Excel 表格模式】你正在帮用户修改一份 Excel 表格，请严格遵守：\n${XLS_RULES}\n\n` +
    `【当前表格「${sheet.name}」内容（CSV）】\n` +
    `${XLS_OPEN}\n${sheet.csv}\n${XLS_CLOSE}\n` +
    `上面这份就是表格的最新内容，用户的新要求是对它的修改意见。无论用户要求改什么（包括改数、增删行、排序），你都必须在 ${XLS_OPEN} 和 ${XLS_CLOSE} 之间输出修改后的完整表格数据，不要只输出修改的部分。`
  );
}

/** 系统提示：新建矢量图像。编辑已有图像时附带当前代码。 */
export function svgPrompt(art: Extract<Artifact, { kind: "svg" }>): string {
  return (
    `【图像绘制模式】你正在帮用户修改一幅 SVG 图像，请严格遵守：\n${SVG_RULES}\n\n` +
    `【当前图像「${art.name}」的 SVG 代码】\n` +
    `${SVG_OPEN}\n${art.code}\n${SVG_CLOSE}\n` +
    `上面这份就是图像的最新代码，用户的新要求是对它的修改意见。无论用户要求改什么，你都必须在 ${SVG_OPEN} 和 ${SVG_CLOSE} 之间输出修改后的完整 SVG 代码。`
  );
}

/** 用户消息里出现这些词时，认为是画图需求。 */
const IMAGE_WORDS = [
  "图像", "图片", "画一", "画个", "画张", "画幅", "画图", "插画", "示意图",
  "流程图", "架构图", "关系图", "思维导图", "图标", "logo", "海报", "简笔",
  "素描", "线稿", "壁纸", "svg",
];

export function hasImageIntent(text: string): boolean {
  const t = text.toLowerCase();
  return IMAGE_WORDS.some((w) => t.includes(w));
}

const DIAGRAM_WORDS = ["流程图", "示意图", "架构图", "思维导图", "关系图", "图标", "logo", "拓扑图"];

/** 示意图/流程图类：SD 画不好带文字的图，这类走模型画的 SVG。 */
export function hasDiagramIntent(text: string): boolean {
  const t = text.toLowerCase();
  return DIAGRAM_WORDS.some((w) => t.includes(w));
}

/** 从 SVG 代码里清理危险内容（脚本、事件属性、外部引用），并做渲染前修补。 */
export function sanitizeSvg(code: string): string {
  let s = code
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, "$1=$2#$2")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "");

  // 模型常在标记里夹带说明文字或尾注，只保留 <svg>…</svg> 根元素，否则 XML 解析失败
  const m = /<svg[\s\S]*<\/svg\s*>/i.exec(s);
  if (m) s = m[0];

  // 补 xmlns：缺了它 <img> 会按普通 XML 解析，整张图直接渲染失败
  const svgTag = /<svg\b[^>]*>/i.exec(s)?.[0];
  if (svgTag && !/\sxmlns\s*=/i.test(svgTag)) {
    s = s.replace(svgTag, svgTag.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'));
  }
  // 用到 xlink:href 时补命名空间
  if (/xlink:href/i.test(s) && !/\sxmlns:xlink\s*=/i.test(s) && svgTag) {
    s = s.replace(svgTag, svgTag.replace(/>$/, ' xmlns:xlink="http://www.w3.org/1999/xlink">'));
  }
  return s;
}

/** 给图像取个名字：优先 <title>，否则取说明文字，兜底"未命名图像"。 */
export function deriveSvgName(code: string, chat: string): string {
  const t = /<title[^>]*>([^<]+)<\/title>/i.exec(code)?.[1];
  const line = (chat || "").trim().split("\n", 1)[0] ?? "";
  const name = (t ?? line)
    .replace(/[#*`_>~[\]()"']/g, "")
    .replace(/^(这是|画了|给你|好的[，,]?|以下是?)/, "")
    .replace(/(一幅|一张|一个|简单的?|漂亮的?)$/g, "")
    .trim()
    .slice(0, 16);
  return name || "未命名图像";
}

export interface SplitArtifact {
  /** 标记之外的聊天文字（显示用；完整原文仍在消息 content 里） */
  chat: string;
  /** Word 文档正文（Markdown），模型还没写完时是已到达的部分 */
  doc: string | null;
  /** Excel 表格数据（CSV），同上 */
  xls: string | null;
  /** SVG 图像代码，同上 */
  svg: string | null;
  /** 当前有标记块还没有出现结束标记（正在流式生成中） */
  streaming: boolean;
}

const MARKERS: { open: string; close: string; key: "doc" | "xls" | "svg" }[] = [
  { open: DOC_OPEN, close: DOC_CLOSE, key: "doc" },
  { open: XLS_OPEN, close: XLS_CLOSE, key: "xls" },
  { open: SVG_OPEN, close: SVG_CLOSE, key: "svg" },
];

/** 从模型输出里拆出聊天文字与文档/表格/图像内容；无标记时均为 null。 */
export function splitArtifact(content: string): SplitArtifact {
  let chat = "";
  let doc: string | null = null;
  let xls: string | null = null;
  let svg: string | null = null;
  let streaming = false;
  let rest = content;
  for (;;) {
    let hit: (typeof MARKERS)[number] | null = null;
    let at = Number.POSITIVE_INFINITY;
    for (const m of MARKERS) {
      const i = rest.indexOf(m.open);
      if (i >= 0 && i < at) {
        at = i;
        hit = m;
      }
    }
    if (!hit) {
      chat += rest;
      break;
    }
    chat += rest.slice(0, at);
    const after = rest.slice(at + hit.open.length);
    const end = after.indexOf(hit.close);
    const body = cleanBody(end < 0 ? after : after.slice(0, end));
    if (hit.key === "doc") doc = body;
    else if (hit.key === "xls") xls = body;
    else svg = body;
    if (end < 0) {
      streaming = true;
      break;
    }
    rest = after.slice(end + hit.close.length);
  }
  return { chat: chat.trim(), doc, xls, svg, streaming };
}

/** 去掉模型偶尔套在内容外的 Markdown 代码栅栏。 */
function cleanBody(s: string): string {
  let t = s.replace(/^[ \t]*\n/, "").replace(/\s+$/, "");
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9]*[ \t]*\n/, "");
    if (t.endsWith("```")) t = t.replace(/```[ \t]*$/, "").replace(/\s+$/, "");
  }
  return t;
}

/** 从文档内容猜一个文件名：优先第一个 # 标题。 */
export function deriveDocName(md: string): string {
  const h = /^[ \t]*#[ \t]+(.+)$/m.exec(md) ?? /^[ \t]*(.{4,30})[ \t]*$/m.exec(md);
  const name = (h?.[1] ?? "")
    .replace(/[#*`_>~[\]()]/g, "")
    .trim()
    .slice(0, 20);
  return name || "未命名文档";
}

/** 从表格数据猜一个文件名：优先 "## 工作表名"，否则取表头第一格。 */
export function deriveSheetName(csv: string): string {
  const sec = /^[ \t]*##[ \t]+(.+)$/m.exec(csv);
  if (sec) return sanitizeSheetTitle(sec[1]);
  // 忽略图表指令行
  const body = csv.replace(/^[ \t]*(?:图表[:：]|#chart[:：\s]).*$/gim, "");
  const first = body.split("\n", 1)[0]?.split(",")[0] ?? "";
  const name = first.replace(/[#*`_>~[\]()"]/g, "").trim().slice(0, 20);
  return name || "未命名表格";
}

/** 从用户原话猜一个图像名（去掉"画一张…"这类指令词）。 */
export function deriveImageName(userText: string): string {
  const name = userText.replace(/[画一张个幅图：:，,。？?！!的]/g, "").trim().slice(0, 12);
  return name || "图像";
}

function sanitizeSheetTitle(t: string): string {
  const name = t.replace(/[#*`_>~[\]"]/g, "").trim().slice(0, 31);
  // 模型照抄规则示例的占位名时回退为默认名
  if (!name || name === "工作表名" || name === "表名" || name === "Sheet名") return "Sheet1";
  return name;
}

export interface SheetData {
  name: string;
  rows: string[][];
}

/** RFC4180 子集：支持引号包裹、双引号转义、单元格内换行。
 *  宽容处理：未加引号的中文逗号「，」也按分隔符解析（4B 模型常混用中英文逗号，
 *  引号内的文本逗号不受影响）。 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === "," || c === "\uFF0C") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** 把 XLS 标记里的内容解析成若干工作表；"## 名称" 开启新表。容忍流式到达的半截数据。 */
export function parseSheets(csvText: string): SheetData[] {
  const sections: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } = { name: "Sheet1", lines: [] };
  for (const line of csvText.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^[ \t]*[>]+[ \t]*$/.test(line)) continue; // 模型偶尔输出的 ">>>" 垃圾行
    const m = /^[ \t]*##[ \t]*(.+?)[ \t]*$/.exec(line);
    if (m) {
      if (cur.lines.length) sections.push(cur);
      cur = { name: sanitizeSheetTitle(m[1]), lines: [] };
    } else cur.lines.push(line);
  }
  if (cur.lines.length) sections.push(cur);
  const sheets = sections
    .map((s) => ({ name: s.name, rows: parseCsvRows(s.lines.join("\n")) }))
    .filter((s) => s.rows.length > 0);
  return sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
}

/** 图表类型；null = 未指定。 */
export type ChartType = "bar" | "line" | "pie";

/** 把单元格文本转成数字；不是数字时返回 null（支持 ¥/%、千分位逗号）。 */
export function cellToNumber(text: string): number | null {
  let t = text.trim();
  if (!t) return null;
  t = t.replace(/^[¥$￥]/, "").replace(/%$/, "").replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** 提取并移除模型输出里的图表指令行（图表：柱状图 / #chart: bar 等）。 */
export function stripChartDirective(csvText: string): { csv: string; chart: ChartType | null } {
  const lines = csvText.replace(/\r\n?/g, "\n").split("\n");
  let chart: ChartType | null = null;
  const kept = lines.filter((line) => {
    const m = /^[ \t]*(?:图表[:：]|#chart[:：\s])[ \t]*(.*)$/i.exec(line);
    if (!m) return true;
    const t = m[1];
    if (/柱|bar/i.test(t)) chart = "bar";
    else if (/折|line/i.test(t)) chart = "line";
    else if (/饼|pie/i.test(t)) chart = "pie";
    return false;
  });
  return { csv: kept.join("\n"), chart };
}

const CHART_WORDS = ["图表", "柱状", "折线", "饼图", "扇形", "可视化", "趋势图", "chart"];

/** 用户消息里是否要求了图表。没要求时忽略模型擅自输出的图表指令。 */
export function hasChartIntent(text: string): boolean {
  const t = text.toLowerCase();
  return CHART_WORDS.some((w) => t.includes(w));
}

/** 从用户消息里推断具体图表类型；没提类型时返回 null。 */
export function chartTypeFromText(text: string): ChartType | null {
  if (/柱/.test(text)) return "bar";
  if (/折线/.test(text)) return "line";
  if (/饼|扇形/.test(text)) return "pie";
  return null;
}

/**
 * 提交表格产物前的最终整理：
 * - 用户要求了图表（或编辑前已有图）才保留图表指令；模型擅自加的一律剥离。
 * - 用户要求了图表但模型没给指令时，从用户话里推断类型直接应用（默认柱状图）。
 * - 用户指定的类型优先于模型指令。
 */
export function finalizeSheetCsv(
  modelCsv: string,
  chatText: string,
  userText: string,
  prev?: Artifact | null,
): string {
  const stripped = stripChartDirective(modelCsv);
  let chart = stripped.chart;
  if (!chart) {
    const m = chatText.match(/图表[:：][ \t]*(柱状图|折线图|饼图)/);
    if (m) chart = m[1] === "柱状图" ? "bar" : m[1] === "折线图" ? "line" : "pie";
  }
  const prevChart = prev?.kind === "excel" ? stripChartDirective(prev.csv).chart : null;
  const wantChart = hasChartIntent(userText) || prevChart !== null;
  const final = chartTypeFromText(userText) ?? chart ?? prevChart ?? "bar";
  if (!wantChart || !final) return stripped.csv;
  const label = final === "bar" ? "柱状图" : final === "line" ? "折线图" : "饼图";
  return `图表：${label}\n${stripped.csv}`;
}

const MD_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const isMdTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line) || (line.includes("|") && line.trim().split("|").length >= 3);

/** 模型没走 XLS 协议时，把回答里的第一个 Markdown 表格转成 CSV 兜底；
 *  同时捕获「图表：xxx」指令行。找不到表格时返回 null。 */
export function mdTableToCsv(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const directive = text.match(/^[ \t]*图表[:：][ \t]*(柱状图|折线图|饼图)[ \t]*$/m)?.[0];
  let start = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    if (isMdTableRow(lines[i]) && MD_TABLE_SEP.test(lines[i + 1])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const rows: string[][] = [];
  let i = start;
  while (i < lines.length && isMdTableRow(lines[i])) {
    if (!MD_TABLE_SEP.test(lines[i])) {
      const cells = lines[i]
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.replace(/\*\*|__|`/g, "").trim());
      rows.push(cells);
    }
    i++;
  }
  if (rows.length < 2 || Math.max(...rows.map((r) => r.length)) < 2) return null;
  const csv = rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
  return directive ? `${directive}\n${csv}` : csv;
}

/** 第三层兜底：模型把 CSV 直接当纯文本输出（无标记、无 Markdown 表格）时，
 *  找出"连续多行、逗号数一致"的文本块当作 CSV（中英文逗号都算，
 *  parseCsvRows 会统一处理）。需至少 3 行且多数含数字，避免把散文误判成表格。 */
export function rawCsvBlock(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const commaCount = (s: string) => (s.match(/[,，]/g) || []).length;
  let best: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    const looksCsv =
      t.length > 0 &&
      commaCount(t) >= 2 &&
      !t.startsWith("|") &&
      !t.startsWith(">") &&
      !t.startsWith("-") &&
      !t.startsWith("*") &&
      !t.startsWith("```") &&
      !/^#{1,6}\s/.test(t) &&
      !/^(图表|chart)[:：]/i.test(t) &&
      !/[。；！？]$/.test(t);
    if (looksCsv) cur.push(t);
    else {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
  }
  if (cur.length > best.length) best = cur;
  if (best.length < 3) return null;
  const commas = commaCount(best[0]);
  if (commas < 2 || best.some((l) => commaCount(l) !== commas)) return null;
  if (best.filter((l) => /\d/.test(l)).length < 2) return null;
  const directive = text.match(/^[ \t]*图表[:：][ \t]*(柱状图|折线图|饼图)[ \t]*$/m)?.[0];
  const csv = best.join("\n");
  return directive ? `${directive}\n${csv}` : csv;
}
