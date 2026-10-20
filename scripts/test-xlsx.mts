// parseSheets / parseCsvRows / buildWorkbook 的 Node 端验证。
// 运行：node scripts/test-xlsx.mts
import { writeFileSync, unlinkSync } from "node:fs";
import * as XLSX from "xlsx";
import { buildWorkbook } from "../src/lib/xlsxExport.ts";
import {
  deriveSheetName,
  parseCsvRows,
  parseSheets,
  splitArtifact,
  cellToNumber,
  stripChartDirective,
  sanitizeSvg,
  hasImageIntent,
  deriveSvgName,
} from "../src/lib/wordDoc.ts";
import { extractChartData } from "../src/lib/charts.ts";

let fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) fail++;
};

// ---- splitArtifact：双标记流式拆分 ----
{
  const plain = splitArtifact("你好呀");
  check("纯聊天：无产物", plain.doc === null && plain.xls === null && !plain.streaming);

  const both = splitArtifact("先看文档\n<<<DOC\n# 标题\n正文\nDOC>>>\n再看表格\n<<<XLS\nA,B\n1,2\nXLS>>>");
  check("双标记完整：拆分正确", both.doc === "# 标题\n正文" && both.xls === "A,B\n1,2" && !both.streaming);
  check("双标记完整：聊天文字", both.chat.includes("先看文档") && both.chat.includes("再看表格"));

  const partial = splitArtifact("好的\n<<<XLS\n姓名,分数\n张三,95");
  check("XLS 流式中：partial 可见", partial.xls === "姓名,分数\n张三,95" && partial.streaming);

  const docPartial = splitArtifact("<<<DOC\n# 合同");
  check("DOC 流式中", docPartial.doc === "# 合同" && docPartial.doc === docPartial.doc && docPartial.streaming);

  const fenced = splitArtifact("<<<XLS\n```\nA,B\n1,2\n```");
  check("XLS 外层代码栅栏被剥掉", fenced.xls === "A,B\n1,2");
}

// ---- parseCsvRows：引号、转义、单元格内换行 ----
{
  const rows = parseCsvRows('姓名,备注\n"张,三","多行\n备注"\n"他说""你好""",5');
  check("CSV 引号逗号", rows[1][0] === "张,三");
  check("CSV 单元格内换行", rows[1][1] === "多行\n备注");
  check("CSV 双引号转义", rows[2][0] === '他说"你好"');
  check("CSV 数字保持字符串由导出层转换", rows[2][1] === "5");
}

// ---- parseSheets：多工作表分节 ----
{
  const sheets = parseSheets("## 一月\nA,B\n1,2\n\n## 二月\nA,B\n3,4");
  check("两个工作表", sheets.length === 2 && sheets[0].name === "一月" && sheets[1].name === "二月");
  check("各表行数正确", sheets[0].rows.length === 2 && sheets[1].rows.length === 2);
  check("无分节默认 Sheet1", parseSheets("A,B\n1,2")[0].name === "Sheet1");
}

// ---- buildWorkbook → 读回断言 ----
{
  const csv = [
    "## 成绩",
    "姓名,语文,数学,平均",
    "张三,90,95,92.5",
    "李四,88,92,90",
    "",
    "## 汇总",
    "项目,值",
    "人数,2",
  ].join("\n");
  const wb = buildWorkbook(csv);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  console.log(`xlsx size: ${out.length} bytes, zip magic: ${out[0] === 0x50 && out[1] === 0x4b}`);
  const back = XLSX.read(out);
  check("两个工作表都写入", back.SheetNames.join(",") === "成绩,汇总");
  const ws = back.Sheets["成绩"];
  check("表头字符串", ws["A1"].v === "姓名" && ws["B1"].v === "语文");
  check("数字转成数值类型", ws["B2"].v === 90 && typeof ws["B2"].v === "number" && ws["D2"].v === 92.5);
  check("第二个表内容", back.Sheets["汇总"]["B2"].v === 2);

check("deriveSheetName 取分节名", deriveSheetName(csv) === "成绩");
check("deriveSheetName 兜底表头第一格", deriveSheetName("姓名,分数\n张三,95") === "姓名");

// ---- 图表指令与图表数据提取 ----
{
  const a = stripChartDirective("图表：柱状图\nA,B\n1,2");
  check("图表指令：柱状图", a.chart === "bar" && a.csv === "A,B\n1,2");
  const b = stripChartDirective("#chart: line\nA,B\n1,2");
  check("图表指令：#chart line", b.chart === "line");
  const c = stripChartDirective("A,B\n1,2");
  check("无图表指令", c.chart === null && c.csv === "A,B\n1,2");
  check("cellToNumber 千分位/百分号", cellToNumber("1,234") === 1234 && cellToNumber("85%") === 85 && cellToNumber("张三") === null);

  const rows = [
    ["姓名", "语文", "数学"],
    ["张三", "90", "95"],
    ["李四", "88", "92"],
  ];
  const chart = extractChartData(rows);
  check("图表数据：标签取非数值列", chart.labels.join(",") === "张三,李四");
  check("图表数据：数值列成系列", chart.series.length === 2 && chart.series[0].name === "语文" && chart.series[1].values.join(",") === "95,92");

  const withIdx = [
    ["序号", "月份", "金额"],
    ["1", "一月", "100"],
    ["2", "二月", "200"],
  ];
  const chart2 = extractChartData(withIdx);
  check("图表数据：序号列被跳过", chart2.series.length === 1 && chart2.series[0].name === "金额");
}

// ---- SVG 图像：拆分 / 消毒 / 命名 ----
{
  const s = splitArtifact("画好了\n<<<SVG\n<svg viewBox=\"0 0 100 100\"><rect width=\"100\" height=\"100\"/></svg>\nSVG>>>");
  check("SVG 拆分", s.svg?.startsWith("<svg") === true && s.chat === "画好了" && !s.streaming);

  const p = splitArtifact("<<<SVG\n<svg><rec");
  check("SVG 流式中", p.svg === "<svg><rec" && p.streaming);

  const dirty = "<svg onload=\"evil()\"><script>alert(1)</script><a href=\"javascript:x\">t</a><foreignObject><body/></foreignObject></svg>";
  const clean = sanitizeSvg(dirty);
  check("SVG 消毒：去掉 script/onload/javascript:/foreignObject", !clean.includes("<script") && !clean.includes("onload") && !clean.includes("javascript:") && !clean.includes("foreignObject"));

  check("hasImageIntent：画一张流程图", hasImageIntent("画一张流程图"));
  check("hasImageIntent：普通聊天为否", !hasImageIntent("今天天气不错"));
  check("deriveSvgName 取说明", deriveSvgName("<svg><title>太阳系</title></svg>", "") === "太阳系");
}
}

const outPath = new URL("./out.xlsx", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
writeFileSync(outPath, XLSX.write(buildWorkbook("A,B\n1,2"), { bookType: "xlsx", type: "buffer" }));
if (!process.argv.includes("--keep")) unlinkSync(outPath);

if (fail) {
  console.error(`${fail} 项断言失败`);
  process.exit(1);
}
console.log("全部断言通过");
