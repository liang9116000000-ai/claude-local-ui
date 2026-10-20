// mdToDocxBlob 的 Node 端验证：生成 .docx 后直接解包 zip 断言内容。
// 运行：node scripts/test-docx.mts
import { writeFileSync, unlinkSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { mdToDocxBlob } from "../src/lib/docxExport.ts";

const L = [
  "# 房屋租赁合同",
  "",
  "甲方（出租方）：**张三**",
  "乙方（承租方）：李四",
  "",
  "根据《中华人民共和国民法典》及相关法律法规，甲乙双方在平等、自愿、协商一致的基础上，达成如下协议：",
  "",
  "## 第一条 租赁期限",
  "",
  "租赁期限为 *一年*，自 2026 年 1 月 1 日起至 2026 年 12 月 31 日止。",
  "",
  "## 第二条 租金与支付",
  "",
  "1. 月租金为人民币 3000 元；",
  "2. 乙方应于每月 `5 日` 前支付；",
  "3. 押金为两个月租金。",
  "",
  "## 第三条 双方权利义务",
  "",
  "- 甲方保证房屋权属清晰；",
  "- 乙方按时支付租金，不得转租。",
  "",
  "## 第四条 费用明细",
  "",
  "| 项目 | 金额（元） | 备注 |",
  "| --- | --- | --- |",
  "| 月租金 | 3000 | 含物业费 |",
  "| 押金 | 6000 | 退租时退还 |",
  "",
  "> 本合同一式两份，甲乙双方各执一份，自签字之日起生效。",
  "",
  "---",
  "",
  "```text",
  "水表读数：100 吨",
  "电表读数：2000 度",
  "```",
];
const MD = L.join("\n");

const blob = await mdToDocxBlob(MD);
const buf = Buffer.from(await blob.arrayBuffer());
const out = new URL("./out.docx", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
writeFileSync(out, buf);
console.log(`docx size: ${buf.length} bytes, zip magic: ${buf[0] === 0x50 && buf[1] === 0x4b}`);

// ---- 解包 zip（走中央目录，支持 deflate） ----
function readZip(b: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("EOCD not found");
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const method = b.readUInt16LE(off + 10);
    const csize = b.readUInt32LE(off + 20);
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    const lho = b.readUInt32LE(off + 42);
    const name = b.slice(off + 46, off + 46 + nameLen).toString("utf8");
    const lNameLen = b.readUInt16LE(lho + 26);
    const lExtraLen = b.readUInt16LE(lho + 28);
    const dStart = lho + 30 + lNameLen + lExtraLen;
    const cdata = b.slice(dStart, dStart + csize);
    entries.set(name, method === 0 ? cdata : inflateRawSync(cdata));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const zip = readZip(buf);
const xml = zip.get("word/document.xml")?.toString("utf8") ?? "";
const num = zip.get("word/numbering.xml")?.toString("utf8") ?? "";

let fail = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) fail++;
};

check("word/document.xml 存在", xml.length > 0);
check("word/numbering.xml 存在", num.includes("numbering"));
check("标题文本", xml.includes("房屋租赁合同"));
check("加粗 run (<w:b/>)", xml.includes("<w:b/>"));
check("斜体 run (<w:i/>)", xml.includes("<w:i/>"));
check("行内代码用 Consolas", xml.includes("Consolas"));
check("表格 <w:tbl> 且表头加粗", xml.includes("<w:tbl>") && xml.includes("物业费"));
check("引用块缩进", xml.includes("一式两份"));
check("代码块内容", xml.includes("水表读数"));
check("宋体 eastAsia 字体", xml.includes("宋体"));
// 两个有序列表应使用不同的 numId 实例（编号各自从 1 开始）
const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1]);
check(`有序列表独立编号实例 (numId: ${[...new Set(numIds)].join(",")})`, new Set(numIds).size >= 2);

if (process.argv.includes("--keep")) console.log(`保留样例文件: ${out}`);
else unlinkSync(out);
if (fail) {
  console.error(`${fail} 项断言失败`);
  process.exit(1);
}
console.log("全部断言通过");
