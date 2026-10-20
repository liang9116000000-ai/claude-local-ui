export interface Msg {
  role: "user" | "assistant";
  content: string;
  /** live reasoning trace from the model, streamed as it arrives */
  reasoning?: string;
  /** seconds spent reasoning, set once the answer starts */
  thinkSeconds?: number;
  /** generation hit the per-turn cap or was stopped mid-answer */
  truncated?: boolean;
  /** Token counts for this model generation; estimates are explicitly marked. */
  tokenUsage?: TokenUsage;
  /** 本条回复调用了本地绘图模型生成图像（面板可重画） */
  imageGen?: { name: string; prompt: string };
  attachments?: { name: string; text: string }[];
}

export interface TokenUsage {
  id: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "server" | "estimate";
}

export interface Conv {
  id: string;
  title: string;
  messages: Msg[];
  createdAt: number;
  /** 本会话当前的产物（Word 文档 / Excel 表格 / SVG 图像），由模型在标记里生成 / 修订 */
  artifact?: Artifact;
}

/** 右侧面板展示并导出为 .docx / .xlsx / .png 的内容。 */
export interface DocArtifact {
  kind: "word";
  name: string;
  md: string;
}

export interface SheetArtifact {
  kind: "excel";
  name: string;
  /** XLS 标记内的原始文本：CSV，可用 "## 工作表名" 分节 */
  csv: string;
}

export interface SvgArtifact {
  kind: "svg";
  name: string;
  /** SVG 标记内的原始代码（自包含 <svg> 根元素） */
  code: string;
}

export interface ImageArtifact {
  kind: "image";
  name: string;
  /** 本地绘图模型（FLUX.2 klein）用的英文提示词 */
  prompt: string;
  /** 生成的图片（data URL）。只在内存里：不写入 localStorage，刷新后用提示词重画 */
  src?: string;
}

export type Artifact = DocArtifact | SheetArtifact | SvgArtifact | ImageArtifact;

export type ApiMessage = { role: "user" | "assistant" | "system"; content: string };
