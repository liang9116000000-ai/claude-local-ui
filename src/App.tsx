import { useCallback, useEffect, useRef, useState } from "react";
import Composer from "./components/Composer";
import DocPanel from "./components/DocPanel";
import ImagePanel from "./components/ImagePanel";
import MessageRow from "./components/MessageRow";
import PhotoPanel from "./components/PhotoPanel";
import SheetPanel from "./components/SheetPanel";
import Sidebar from "./components/Sidebar";
import TokenUsagePanel from "./components/TokenUsagePanel";
import { streamChat } from "./api";
import { makeEstimatedPromptUsage } from "./lib/tokenUsage";
import { MODEL_DISPLAY_NAME } from "./lib/model";
import {
  DOC_HINT,
  FICTION_HINT,
  SVG_HINT,
  XLS_HINT,
  CODE_HINT,
  deriveDocName,
  deriveImageName,
  deriveSheetName,
  deriveSvgName,
  docPrompt,
  finalizeSheetCsv,
  hasChartIntent,
  hasCodeIntent,
  hasDiagramIntent,
  hasFictionIntent,
  hasImageIntent,
  hasTableIntent,
  mdTableToCsv,
  rawCsvBlock,
  splitArtifact,
  stripDocMarkers,
  svgPrompt,
  xlsPrompt,
} from "./lib/wordDoc";
import type { ApiMessage, Artifact, Conv, Msg, TokenUsage } from "./types";

const LS_KEY = "claude-local-convs";

// 绘图服务（本机 sd-server）同样只能同源访问：dev 走 vite 的 /sd 代理，
// 生产走部署服务器 nginx 的 /sd 反代（+ 隧道）。详见 api.ts 的说明。
const SD_BASE: string = (import.meta.env.VITE_SD_BASE as string | undefined) || "/sd";

function loadConvs(): Conv[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Conv[]) : [];
  } catch {
    return [];
  }
}

function downloadBackup(convs: Conv[]) {
  const payload = {
    format: "claude-local-ui-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    conversations: convs,
  };
  let json: string;
  try {
    json = JSON.stringify(payload, null, 2);
  } catch {
    window.alert("备份内容无法序列化，请稍后重试。");
    return;
  }
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `知序AI备份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseBackup(value: unknown): Conv[] {
  const data = value as { format?: unknown; conversations?: unknown };
  if (data?.format !== "claude-local-ui-backup" || !Array.isArray(data.conversations)) {
    throw new Error("文件格式不正确，请选择知序 AI 导出的 JSON 备份。");
  }
  if (data.conversations.length > 10000) throw new Error("备份中的对话数量过多，无法安全导入。");
  const valid = data.conversations.filter((c): c is Conv => {
    if (!c || typeof c !== "object") return false;
    const item = c as Partial<Conv>;
    return typeof item.id === "string" && typeof item.title === "string" &&
      typeof item.createdAt === "number" && Array.isArray(item.messages) &&
      item.messages.every((m) => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") &&
      (!item.artifact || ["word", "excel", "svg", "image"].includes(item.artifact.kind));
  });
  if (!valid.length && data.conversations.length) throw new Error("备份中没有有效的对话记录。");
  return valid;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** Download the active conversation as Markdown (thinking as blockquotes). */
function exportConv(c: Conv) {
  const parts: string[] = [`# ${c.title}`, ""];
  for (const m of c.messages) {
    if (m.role === "user") {
      parts.push(`## 用户\n\n${m.content}`, "");
    } else {
      if (m.reasoning) {
        parts.push(
          "> 💭 思考过程\n" +
            m.reasoning
              .split("\n")
              .map((l) => `> ${l}`)
              .join("\n"),
          "",
        );
      }
      // 文档 / 表格 / 图像内容单独显示在右侧面板里，导出时用一行说明代替整个标记块
      const sp = splitArtifact(m.content);
      let text = sp.chat;
      const what = sp.svg ? "图像" : sp.xls ? "表格" : "文档";
      if (sp.doc || sp.xls || sp.svg) {
        text +=
          (text ? "\n\n" : "") +
          `> 📄 ${sp.streaming ? `正在生成${what}…` : `已生成 / 更新${what}（见右侧面板）`}`;
      }
      parts.push(`## 助手\n\n${text}`, "");
    }
  }
  const blob = new Blob([parts.join("\n")], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(c.title || "对话").slice(0, 24)}-${new Date()
    .toISOString()
    .slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** randomUUID 仅安全上下文（HTTPS/localhost）可用，HTTP 公网访问会 undefined。 */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type ReportedUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

/** 把流式回调里收集到的 usage 转成消息级 TokenUsage（流结束后调用）。 */
function finalizeUsage(usage: ReportedUsage | null): TokenUsage | undefined {
  return usage ? { ...usage, id: uuid(), source: "server" } : undefined;
}

/** 新建会话对象（放在模块层，避免渲染期调用 Date.now 的 lint 告警）。 */
function makeConv(title: string, messages: Msg[]): Conv {
  return { id: uuid(), title, messages, createdAt: Date.now() };
}

function replaceTrailingAssistant(messages: Msg[], content: string, extra?: Partial<Msg>): Msg[] {
  const previous = messages.at(-1);
  return [
    ...messages.slice(0, -1),
    { ...(previous?.role === "assistant" ? previous : {}), role: "assistant" as const, content, ...extra },
  ];
}

export default function App() {
  const [convs, setConvs] = useState<Conv[]>(loadConvs);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusMessage, setFocusMessage] = useState<{ convId: string; index: number } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [backupNotice, setBackupNotice] = useState("");
  const [usageOpen, setUsageOpen] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<{ model: "checking" | "online" | "offline"; image: "checking" | "online" | "offline" }>({ model: "checking", image: "checking" });
  const importRef = useRef<HTMLInputElement>(null);
  const [kbMode, setKbMode] = useState<string>(
    () => localStorage.getItem("claude-local-kb") || "general",
  );

  useEffect(() => {
    localStorage.setItem("claude-local-kb", kbMode);
  }, [kbMode]);
  // 思考开关：默认关——这台 CPU 机器上推理过程要 20-30 秒才出正文。
  // off = 服务端把 think 块在提示里预先闭合，直接开始作答，没有推理过程。
  // 和 CLI 的 --fast 是同一个开关。
  // 存储键换到 -v2：旧键里持久化过旧默认值"on"，只改默认值对老用户无效。
  const [think, setThink] = useState<boolean>(
    () => localStorage.getItem("claude-local-think-v2") === "on",
  );

  useEffect(() => {
    localStorage.setItem("claude-local-think-v2", think ? "on" : "off");
  }, [think]);
  const [dark, setDark] = useState<boolean>(
    () => localStorage.getItem("claude-local-theme") === "dark",
  );
  const [visualStyle, setVisualStyle] = useState<"claude" | "atelier">(
    () => localStorage.getItem("claude-local-style") === "atelier" ? "atelier" : "claude",
  );
  // 右侧产物面板被手动收起；切换会话或有新产物时自动重新打开
  const [panelClosed, setPanelClosed] = useState(false);

  // 本地绘图模型正在出图（面板头部显示"绘制中"）
  const [imageBusy, setImageBusy] = useState(false);
  /** 首次生成尚未落盘的草稿：图片到达前就能打开面板看到加载特效 */
  const [imageDraft, setImageDraft] = useState<{ convId: string; name: string; prompt: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 是否贴在底部（贴着才自动跟随流式输出；用户上翻后暂停，回底部自动恢复） */
  const stickRef = useRef(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("atelier", visualStyle === "atelier");
    localStorage.setItem("claude-local-theme", dark ? "dark" : "light");
    localStorage.setItem("claude-local-style", visualStyle);
  }, [dark, visualStyle]);

  useEffect(() => {
    let live = true;
    const check = async () => {
      const ping = async (url: string) => {
        try { const response = await fetch(url, { signal: AbortSignal.timeout(3500) }); return response.ok ? "online" as const : "offline" as const; }
        catch { return "offline" as const; }
      };
      const [model, image] = await Promise.all([ping("/v1/models"), ping(`${SD_BASE}/v1/models`)]);
      if (live) setServiceStatus({ model, image });
    };
    void check();
    const timer = window.setInterval(() => void check(), 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.dispatchEvent(new Event("claude-focus-search"));
      } else if (event.key.toLowerCase() === "o" && event.shiftKey) {
        event.preventDefault();
        newChat();
        window.dispatchEvent(new Event("claude-focus-composer"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [streaming]);

  const active = convs.find((c) => c.id === activeId) ?? null;
  const msgs = active?.messages ?? [];
  const waiting = streaming && msgs.at(-1)?.content === "";

  useEffect(() => {
    // 图片字节（src）不落 localStorage：太大且会撑爆 5MB 配额，只存提示词。
    // 流式期间每个 token 都会换掉 convs，同步写盘会卡 UI——改成防抖，
    // 页面关闭（pagehide）时再兜底补一次，避免丢最后几百毫秒的对话。
    const persist = () => {
      try {
        localStorage.setItem(
          LS_KEY,
          JSON.stringify(convs, (key, v) => (key === "src" ? undefined : v)),
        );
      } catch {
        /* 配额满等情况静默失败，不影响聊天 */
      }
    };
    const timer = window.setTimeout(persist, 400);
    window.addEventListener("pagehide", persist);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [convs]);

  useEffect(() => {
    // 只在贴底时跟随：避免流式期间强制 reflow，也不打断用户上翻阅读
    const el = scrollRef.current;
    if (focusMessage?.convId === activeId) {
      const target = el?.querySelector(`[data-message-index="${focusMessage.index}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.classList.add("search-hit");
      const timer = window.setTimeout(() => target?.classList.remove("search-hit"), 2200);
      setFocusMessage(null);
      return () => window.clearTimeout(timer);
    }
    if (el && !msgs.length) {
      el.scrollTop = 0;
      return;
    }
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [msgs, focusMessage, activeId]);

  function selectSearchResult(id: string, messageIndex: number) {
    if (streaming) return;
    stickRef.current = false;
    setFocusMessage({ convId: id, index: messageIndex });
    setActiveId(id);
    setPanelClosed(false);
    setSidebarOpen(false);
  }

  const onChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  function newChat() {
    if (streaming) return;
    setActiveId(null);
    setPanelClosed(false);
    setSidebarOpen(false);
  }

  function deleteConv(id: string) {
    setConvs((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function renameConv(id: string, title: string) {
    setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("备份文件超过 100 MB，浏览器无法可靠导入。");
      const imported = parseBackup(JSON.parse(await file.text()));
      const existing = new Set(convs.map((c) => c.id));
      const seen = new Set(existing);
      const additions = imported.map((c) => {
        if (!seen.has(c.id)) { seen.add(c.id); return c; }
        const copy = { ...c, id: uuid() };
        seen.add(copy.id);
        return copy;
      });
      setConvs((current) => [...additions, ...current]);
      setBackupNotice(`已导入 ${additions.length} 个对话`);
    } catch (error) {
      setBackupNotice(error instanceof Error ? error.message : "备份导入失败");
    } finally {
      if (importRef.current) importRef.current.value = "";
      window.setTimeout(() => setBackupNotice(""), 4000);
    }
  }

  /** Stream into the trailing (empty) assistant message of `history`. */
  async function runStream(convId: string, history: Msg[], artifact?: Artifact) {
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // send everything except the empty assistant placeholder
    const sent = history.slice(0, -1);
    // 产物规则放 system 消息，且一次只给单一类型的规则（实测 4B 模型对
    // "二选一"合并规则的合规率会掉到六成）：
    // 有产物 -> 该类型的编辑规则；无产物 -> 代码/画图/表格关键词路由，默认文档规则。
    const lastUser = sent.length && sent[sent.length - 1].role === "user"
      ? sent[sent.length - 1].content
      : "";
    // 代码/技术问答：不进文档模式（「继续」接续上一条代码回答时也要认出来）
    const users = sent.filter((m) => m.role === "user").map((m) => m.content);
    const codeProbe =
      lastUser === "继续" && users.length >= 2 ? users[users.length - 2] : lastUser;
    const fictionProbe =
      lastUser === "继续" && users.length >= 2 ? users[users.length - 2] : lastUser;
    const codeMode = !artifact && hasCodeIntent(codeProbe);
    const fictionMode = !hasTableIntent(fictionProbe) && !hasDiagramIntent(fictionProbe) &&
      !hasImageIntent(fictionProbe) && !hasCodeIntent(fictionProbe) && hasFictionIntent(fictionProbe);
    const sys =
      artifact?.kind === "word"
        ? fictionMode ? `${docPrompt(artifact)}\n\n${FICTION_HINT}` : docPrompt(artifact)
        : artifact?.kind === "excel"
          ? xlsPrompt(artifact)
          : artifact?.kind === "svg"
            ? svgPrompt(artifact)
            : codeMode
              ? CODE_HINT
              : hasDiagramIntent(lastUser)
                ? SVG_HINT
                : hasTableIntent(lastUser) || hasChartIntent(lastUser)
                  ? XLS_HINT
                  : fictionMode ? FICTION_HINT : DOC_HINT;
    const apiMessages: ApiMessage[] = [
      { role: "system", content: sys },
      ...sent.map((m) => ({ role: m.role, content: m.attachments?.length ? `${m.content}\n\n${m.attachments.map((a) => `【附件：${a.name}】\n${a.text}`).join("\n\n")}` : m.content })),
    ];

    let acc = "";
    let reasoning = "";
    let thinkStart = 0;
    let thinkSecs: number | undefined;
    const patch = (content: string, extra?: Partial<Msg>) =>
      setConvs((cs) =>
        cs.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: replaceTrailingAssistant(c.messages, content, extra),
              }
            : c,
        ),
      );
    // 流式 patch 按动画帧合并：本地模型 token 出得快时，每个 token 触发一次
    // 全量 React 渲染会把主线程打满，合并到 ~60fps 肉眼无感、CPU 占用大幅下降。
    let raf = 0;
    const flushPatch = () => {
      raf = 0;
      patch(acc, { reasoning, thinkSeconds: thinkSecs });
    };
    const schedulePatch = () => {
      if (!raf) raf = requestAnimationFrame(flushPatch);
    };
    let finish: string | null = null;
    let reportedUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null;
    let requestFailed = false;
    try {
      finish = await streamChat(apiMessages, {
        signal: ctrl.signal,
        kb: kbMode,
        thinking: think,
        // 放宽单轮上限：文档模式要一次性输出完整文档（服务端上下文窗口足够时，
        // 这里越大越不容易中途截断；被截断仍可点「继续」续写）
        maxTokens: fictionMode ? 8192 : 2048,
        onUsage: (usage) => { reportedUsage = usage; },
        onDelta: (d) => {
          if (reasoning && thinkSecs === undefined) {
            thinkSecs = Math.round(((Date.now() - thinkStart) / 1000) * 10) / 10;
          }
          acc += d;
          // Qwen3.5 sometimes echoes "</think>" inside its own planning text;
          // when the answer side shows another one, everything before it is
          // really more reasoning - move it back so the split lands on the
          // last tag.
          const idx = acc.lastIndexOf("</think>");
          if (idx >= 0) {
            reasoning += acc.slice(0, idx);
            acc = acc.slice(idx + "</think>".length);
          }
          schedulePatch();
        },
        onReasoning: (d) => {
          if (!reasoning) thinkStart = Date.now();
          reasoning += d;
          schedulePatch();
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        requestFailed = true;
        acc = acc || `**请求失败**：${(err as Error).message}`;
        patch(acc);
      }
    } finally {
      // 取消挂起的帧，保证下面的最终 patch 不会被旧内容的 rAF 覆盖
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      // stopped mid-answer or hit the per-turn cap -> offer a continuation
      const truncated = !!acc.trim() && finish !== "stop";
      const serverUsage = finalizeUsage(reportedUsage);
      const tokenUsage: TokenUsage | undefined = serverUsage
        || (!requestFailed && (acc.trim() || reasoning.trim())
          ? makeEstimatedPromptUsage(apiMessages, `${reasoning}\n${acc}`)
          : undefined);
      const sp = splitArtifact(acc);
      const word = sp.doc?.trim() ?? "";
      const xlsCsv = sp.xls?.trim() ?? "";
      const svgCode = sp.svg?.trim() ?? "";
      // 代码请求不进文档：模型不守规矩仍套了 DOC 标记时，去掉标记当普通聊天显示
      const shown = codeMode && word ? stripDocMarkers(acc) : acc;
      if (!acc.trim()) {
        patch("（已停止生成）", { reasoning, truncated: false, ...(tokenUsage ? { tokenUsage } : {}) });
      } else {
        patch(shown, { reasoning, thinkSeconds: thinkSecs, truncated, ...(tokenUsage ? { tokenUsage } : {}) });
      }
      // 模型输出了文档 / 表格 -> 提交到会话，右侧面板随之更新。
      // 生成完整结束才无条件提交；中途停止时只在"新建且已有一定内容"时保留，
      // 避免用半截内容覆盖掉之前的完整产物。
      const keep = (txt: string) =>
        !!txt && (finish === "stop" || !sp.streaming || (!artifact && txt.length >= 40));
      const commit = (a: Artifact) =>
        setConvs((cs) => cs.map((c) => (c.id === convId ? { ...c, artifact: a } : c)));
      if (keep(word) && !codeMode) {
        const name =
          artifact?.kind === "word" ? artifact.name : deriveDocName(word);
        commit({ kind: "word", name, md: word });
        setPanelClosed(false);
      } else if (keep(xlsCsv)) {
        // 图表指令只在用户要求（或编辑前已有图）时保留；聊天文字里的指令也并入判断
        const csv = finalizeSheetCsv(xlsCsv, sp.chat, lastUser, artifact);
        const name =
          artifact?.kind === "excel" ? artifact.name : deriveSheetName(csv);
        commit({ kind: "excel", name, csv });
        setPanelClosed(false);
      } else if (keep(svgCode)) {
        commit({ kind: "svg", name: deriveSvgName(svgCode, sp.chat), code: svgCode });
        setPanelClosed(false);
      } else if (!word && !svgCode && lastUser && hasTableIntent(lastUser)) {
        // 兜底：模型没走 XLS 协议时，把回答里的 Markdown 表格或裸 CSV 文本块
        // 转成表格产物，保证"要表格必有面板"
        const fallbackRaw = mdTableToCsv(acc) ?? rawCsvBlock(acc);
        if (fallbackRaw && keep(fallbackRaw)) {
          const csv = finalizeSheetCsv(fallbackRaw, "", lastUser, artifact);
          commit({ kind: "excel", name: deriveSheetName(csv), csv });
          setPanelClosed(false);
        }
      }
      setStreaming(false);
      abortRef.current = null;
    }
  }

  /** 直接用英文提示词调本地绘图服务（FLUX.2 klein 4B），成功后提交图像产物。 */
  async function generateImage(convId: string, prompt: string, userText: string) {
    setImageBusy(true);
    setStreaming(true);
    // 一发出请求就进入加载态：面板立即打开、显示创作占位卡（ChatGPT 式）；
    // 图片落盘前不写产物，失败或中止时已有的上一张图仍然保留。
    const name = deriveImageName(userText);
    setImageDraft((d) =>
      d && d.convId === convId ? { ...d, prompt } : { convId, name, prompt },
    );
    setPanelClosed(false);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const patch = (content: string, extra?: Partial<Msg>) =>
      setConvs((cs) =>
        cs.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: replaceTrailingAssistant(c.messages, content, extra),
              }
            : c,
        ),
      );
    try {
      const res = await fetch(`${SD_BASE}/v1/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sd-cpp-local", prompt, n: 1, size: "512x512" }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`绘图服务返回 HTTP ${res.status}`);
      const j = (await res.json()) as { data?: { b64_json?: string }[] };
      const b64 = j.data?.[0]?.b64_json;
      if (!b64) throw new Error("绘图服务没有返回图片");
      const src = `data:image/png;base64,${b64}`;
      setConvs((cs) =>
        cs.map((c) =>
          c.id === convId
            ? { ...c, artifact: { kind: "image" as const, name, prompt, src } }
            : c,
        ),
      );
      setPanelClosed(false);
      setImageDraft(null);
      patch(
        `已为你生成图像（见右侧面板）。\n\n> 绘图提示词：\`${prompt}\`\n\n不满意可以点面板上的「重画一张」，或描述想改的地方让我重画。`,
        { imageGen: { name, prompt } },
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        patch("（已停止）");
      } else {
        patch(
          `❌ 生成图像失败：${(err as Error).message}\n\n如果是网络错误，请先启动本地绘图服务（sd-server），然后再说一次「${userText}」。`,
        );
      }
    } finally {
      setImageBusy(false);
      setStreaming(false);
      abortRef.current = null;
    }
  }

  /** 画图入口：先让文字模型把需求翻译成英文绘图提示词，再调本地绘图服务。
   *  有旧提示词时带上上下文，实现"把背景改成夜晚"这类增量修改。 */
  async function runImageGen(
    convId: string,
    userText: string,
    prevPrompt: string | null,
  ) {
    setImageBusy(true);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // 请求一发出就打开面板进入加载态：等待期间始终能看到创作占位卡
    setImageDraft({ convId, name: deriveImageName(userText), prompt: "" });
    setPanelClosed(false);
    const patch = (content: string, extra?: Partial<Msg>) =>
      setConvs((cs) =>
        cs.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: replaceTrailingAssistant(c.messages, content, extra),
              }
            : c,
        ),
      );
    let prompt = "";
    let promptRequestSucceeded = false;
    let reportedUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null;
    const promptMessages: ApiMessage[] = [
      {
        role: "system",
        content: prevPrompt
          ? `You are a prompt engineer for the FLUX.2 image model. Previous prompt: "${prevPrompt}". The user asks for a change (in Chinese). Rewrite the FULL English prompt applying the change. Reply with ONLY the English prompt (natural descriptive sentences, under 80 words), no explanations.`
          : `You are a prompt engineer for the FLUX.2 image model. Turn the user's image request (in Chinese) into ONE English prompt: natural descriptive sentences covering the subject, scene, lighting and style. Under 80 words, no keyword lists. Reply with ONLY the prompt itself, no explanations, no quotes.`,
      },
      { role: "user", content: userText },
    ];
    // 提示词流式展示也按帧合并，和正文流式保持一致
    let raf = 0;
    const flushPrompt = () => {
      raf = 0;
      const t = prompt.replace(/["“”‘’]/g, "").trim();
      if (t) patch(`🎨 ${t}`);
    };
    try {
      await streamChat(
        promptMessages,
        {
          signal: ctrl.signal,
          kb: kbMode,
          thinking: false,
          maxTokens: 160,
          onUsage: (usage) => { reportedUsage = usage; },
          onDelta: (d) => {
            prompt += d;
            if (!raf) raf = requestAnimationFrame(flushPrompt);
          },
        },
      );
      promptRequestSucceeded = true;
    } catch (err) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if ((err as Error).name === "AbortError") {
        const tokenUsage: TokenUsage | undefined = finalizeUsage(reportedUsage)
          || (prompt ? makeEstimatedPromptUsage(promptMessages, prompt) : undefined);
        patch("（已停止）", tokenUsage ? { tokenUsage } : undefined);
        setImageBusy(false);
        setStreaming(false);
        setImageDraft(null);
        abortRef.current = null;
        return;
      }
      // 翻译失败就用原话直接画
      prompt = userText;
    }
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    const generatedPrompt = prompt
      .replace(/["“”‘’]/g, "")
      .replace(/^(prompt|提示词)\s*[:：]?\s*/i, "")
      .trim();
    prompt = generatedPrompt || userText;
    const tokenUsage: TokenUsage | undefined = finalizeUsage(reportedUsage)
      || (promptRequestSucceeded
        ? makeEstimatedPromptUsage(promptMessages, generatedPrompt)
        : undefined);
    patch(`🎨 ${prompt}\n\n🖼 绘制中…（FLUX.2 klein，CPU 约 2~4 分钟）`, tokenUsage ? { tokenUsage } : undefined);
    await generateImage(convId, prompt, userText);
  }

  async function send(text: string, attachments: { name: string; text: string }[] = []) {
    if (streaming) return;
    stickRef.current = true;
    // 真实图像请求：不走文字模型，直接调本地绘图服务（FLUX.2 klein）。
    // 流程图/示意图/表格/图表类仍走文字模型。
    if (
      hasImageIntent(text) &&
      !hasDiagramIntent(text) &&
      !hasTableIntent(text) &&
      !hasChartIntent(text)
    ) {
      const userMsg: Msg = { role: "user", content: text, attachments };
      const asstMsg: Msg = { role: "assistant", content: "" };
      const conv: Conv = active
        ? { ...active, messages: [...active.messages, userMsg, asstMsg] }
        : makeConv(text.slice(0, 24), [userMsg, asstMsg]);
      setConvs((cs) => [conv, ...cs.filter((c) => c.id !== conv.id)]);
      setActiveId(conv.id);
      setSidebarOpen(false);
      const prevPrompt = conv.artifact?.kind === "image" ? conv.artifact.prompt : null;
      await runImageGen(conv.id, text, prevPrompt);
      return;
    }
    const userMsg: Msg = { role: "user", content: text, attachments };
    const asstMsg: Msg = { role: "assistant", content: "" };
    const conv: Conv = active
      ? { ...active, messages: [...active.messages, userMsg, asstMsg] }
      : makeConv(text.slice(0, 24), [userMsg, asstMsg]);
    setConvs((cs) => [conv, ...cs.filter((c) => c.id !== conv.id)]);
    setActiveId(conv.id);
    setSidebarOpen(false);
    await runStream(conv.id, conv.messages, conv.artifact);
  }

  function saveArtifactEdit(kind: "word" | "excel", content: string) {
    if (!active) return;
    setConvs((items) => items.map((c) => c.id !== active.id ? c : {
      ...c,
      artifact: kind === "word"
        ? { kind, name: c.artifact?.kind === "word" ? c.artifact.name : "文档", md: content }
        : { kind, name: c.artifact?.kind === "excel" ? c.artifact.name : "表格", csv: content },
    }));
  }

  function branchFromMessage(index: number) {
    if (!active || streaming) return;
    const copied: Conv = {
      ...active,
      id: uuid(),
      title: `${active.title || "对话"}（分支）`.slice(0, 40),
      messages: active.messages.slice(0, index + 1).map((m) => ({ ...m, attachments: m.attachments?.map((a) => ({ ...a })) })),
      createdAt: Date.now(),
    };
    setConvs((items) => [copied, ...items]);
    setActiveId(copied.id);
    setPanelClosed(false);
  }

  /** Drop the last assistant reply and stream a fresh one. */
  async function regenerate() {
    if (streaming || !active) return;
    stickRef.current = true;
    const msgs = [...active.messages];
    if (!msgs.length || msgs[msgs.length - 1].role !== "assistant") return;
    const popped = msgs.pop()!;
    if (!msgs.length) return;
    const next: Conv = { ...active, messages: [...msgs, { role: "assistant", content: "" }] };
    setConvs((cs) => [next, ...cs.filter((c) => c.id !== next.id)]);
    // 图像消息重新生成：回到画图流程（重翻译提示词，效果随机不同）
    if (popped.imageGen) {
      const prevUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
      await runImageGen(next.id, prevUser, popped.imageGen.prompt);
      return;
    }
    await runStream(next.id, next.messages, next.artifact);
  }

  /** Ask the model to carry on after a truncated answer. */
  async function continueAnswer() {
    if (streaming || !active) return;
    stickRef.current = true;
    const msgs = [...active.messages];
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant" || !last.truncated) return;
    const next: Conv = {
      ...active,
      messages: [
        ...msgs,
        { role: "user", content: "继续" },
        { role: "assistant", content: "" },
      ],
    };
    setConvs((cs) => [next, ...cs.filter((c) => c.id !== next.id)]);
    await runStream(next.id, next.messages, next.artifact);
  }

  function stop() {
    abortRef.current?.abort();
  }

  /** 编辑某条用户消息：截断其后所有消息，改写该条并从头重新生成。 */
  async function editAndResend(index: number, text: string) {
    if (streaming || !active) return;
    const msgs = active.messages;
    if (index < 0 || index >= msgs.length || msgs[index].role !== "user") return;
    stickRef.current = true;
    const base = msgs.slice(0, index);
    const userMsg: Msg = { role: "user", content: text };
    const asstMsg: Msg = { role: "assistant", content: "" };
    const next: Conv = { ...active, messages: [...base, userMsg, asstMsg] };
    setConvs((cs) => [next, ...cs.filter((c) => c.id !== next.id)]);
    // 与 send() 相同的图像意图路由
    if (
      hasImageIntent(text) &&
      !hasDiagramIntent(text) &&
      !hasTableIntent(text) &&
      !hasChartIntent(text)
    ) {
      const prevPrompt = next.artifact?.kind === "image" ? next.artifact.prompt : null;
      await runImageGen(next.id, text, prevPrompt);
      return;
    }
    await runStream(next.id, next.messages, next.artifact);
  }

  // —— 稳定引用：让 MessageRow / Composer 的 memo 真正生效 ——
  // 每次渲染都新建的箭头函数会让所有 memo 子树失效；经 ref 转发到最新闭包。
  const sendRef = useRef(send);
  const regenRef = useRef(regenerate);
  const contRef = useRef(continueAnswer);
  const editRef = useRef(editAndResend);
  useEffect(() => {
    sendRef.current = send;
    regenRef.current = regenerate;
    contRef.current = continueAnswer;
    editRef.current = editAndResend;
  });
  const handleSend = useCallback((t: string) => {
    void sendRef.current(t);
  }, []);
  const handleRegenerate = useCallback(() => {
    void regenRef.current();
  }, []);
  const handleContinue = useCallback(() => {
    void contRef.current();
  }, []);
  const handleEditUser = useCallback((index: number, text: string) => {
    void editRef.current(index, text);
  }, []);
  const openPanel = useCallback(() => setPanelClosed(false), []);

  // 右侧产物面板：流式期间实时取最后一条消息里的标记块，否则用已提交的会话产物。
  // 正在生成的那一类优先于已持久化的一侧。
  // 代码请求（无产物）：流式期间不因 DOC 标记闪出文档面板，正文直接显示在聊天里。
  const userTexts = msgs.filter((m) => m.role === "user").map((m) => m.content);
  const lastUserText = userTexts[userTexts.length - 1] ?? "";
  const liveCodeProbe =
    lastUserText === "继续" && userTexts.length >= 2
      ? userTexts[userTexts.length - 2]
      : lastUserText;
  const codeMode =
    streaming && !active?.artifact && hasCodeIntent(liveCodeProbe);
  const lastMsg = msgs[msgs.length - 1];
  const liveSplit =
    streaming && lastMsg?.role === "assistant" && !codeMode
      ? splitArtifact(lastMsg.content)
      : null;
  const liveWord = liveSplit?.doc ?? null;
  const liveXls = liveSplit?.xls ?? null;
  const liveSvg = liveSplit?.svg ?? null;
  const liveKind: "word" | "excel" | "svg" | null = liveSvg
    ? "svg"
    : liveXls
      ? "excel"
      : liveWord
        ? "word"
        : null;
  let panel: {
    kind: "word" | "excel" | "svg";
    name: string;
    content: string;
    live: boolean;
  } | null = null;
  if (liveKind) {
    const persistName =
      active?.artifact?.kind === liveKind ? active.artifact.name : null;
    const content = liveKind === "word" ? liveWord! : liveKind === "excel" ? liveXls! : liveSvg!;
    panel = {
      kind: liveKind,
      name:
        persistName ??
        (liveKind === "word"
          ? deriveDocName(content)
          : liveKind === "excel"
            ? deriveSheetName(content)
            : deriveSvgName(content, "")),
      content,
      live: !!liveSplit?.streaming,
    };
  } else if (active?.artifact && active.artifact.kind !== "image") {
    const a = active.artifact;
    panel =
      a.kind === "word"
        ? { kind: "word", name: a.name, content: a.md, live: false }
        : a.kind === "excel"
          ? { kind: "excel", name: a.name, content: a.csv, live: false }
          : { kind: "svg", name: a.name, content: a.code, live: false };
  }
  // AI 生成的真实图像（FLUX.2 klein）：src 只在内存里，刷新后靠提示词重画
  const imageArtifact = active?.artifact?.kind === "image" ? active.artifact : null;
  /** 本会话正在生成、还没有图片的草稿（加载特效期间显示） */
  const pendingImage =
    imageDraft && active && imageDraft.convId === active.id ? imageDraft : null;

  return (
    <div className="flex h-full">
      <Sidebar
        convs={convs}
        activeId={activeId}
        open={sidebarOpen}
        onSelect={(id) => {
          if (!streaming) {
            setActiveId(id);
            setPanelClosed(false);
          }
          setSidebarOpen(false);
        }}
        onNew={newChat}
        onDelete={deleteConv}
        onClose={() => setSidebarOpen(false)}
        onRename={renameConv}
        onSelectResult={selectSearchResult}
        onExportBackup={() => downloadBackup(convs)}
        onImportBackup={() => importRef.current?.click()}
        backupNotice={backupNotice}
      />
      <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importBackup(e.target.files?.[0])} />

      <main className={`app-main flex min-w-0 flex-1 flex-col ${msgs.length === 0 ? "is-empty" : ""}`}>
        <header className="app-header flex items-center gap-2 px-4 py-3">
          <button
            className="rounded-lg p-1.5 text-ink-soft hover:bg-sand md:hidden"
            onClick={() => setSidebarOpen((v) => !v)}
            title="菜单"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="model-chip flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-ink-soft" title={`知序 AI · ${MODEL_DISPLAY_NAME} · 本地运行`}>
            知序 AI
          </span>
          <span title={`模型服务：${serviceStatus.model === "online" ? "在线" : serviceStatus.model === "offline" ? "离线" : "检测中"}；绘图服务：${serviceStatus.image === "online" ? "在线" : serviceStatus.image === "offline" ? "离线" : "检测中"}`} className="service-chip flex items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-ink-soft">
            <i className={`h-2 w-2 rounded-full ${serviceStatus.model === "online" ? "bg-green-500" : serviceStatus.model === "offline" ? "bg-red-400" : "bg-amber-400"}`} />模型
            <i className={`h-2 w-2 rounded-full ${serviceStatus.image === "online" ? "bg-green-500" : serviceStatus.image === "offline" ? "bg-red-400" : "bg-amber-400"}`} />绘图
          </span>
          <select
            value={kbMode}
            disabled={streaming}
            onChange={(e) => setKbMode(e.target.value)}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-soft outline-none disabled:opacity-50"
            title="知识库模式：通用 / 中医顾问 / 心理陪伴"
          >
            <option value="general">通用</option>
            <option value="tcm">中医顾问</option>
            <option value="counselor">心理陪伴</option>
          </select>
          <select
            value={visualStyle}
            onChange={(e) => setVisualStyle(e.target.value as "claude" | "atelier")}
            className="style-select rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-soft outline-none"
            aria-label="界面风格"
            title="切换界面风格"
          >
            <option value="claude">标准风格</option>
            <option value="atelier">雅致风格</option>
          </select>
          <button
            onClick={() => setThink((v) => !v)}
            disabled={streaming}
            title={
              think
                ? "思考过程：开（点此关闭，回答更快、不显示推理过程）"
                : "思考过程：关（点此开启，会先输出推理过程）"
            }
            className={`rounded-full border border-line px-2.5 py-1 text-[12px] disabled:opacity-50 ${
              think
                ? "bg-surface text-ink-soft hover:bg-sand"
                : "bg-sand text-clay-deep hover:bg-surface"
            }`}
          >
            {think ? "思考 开" : "思考 关"}
          </button>
          {active?.artifact && panelClosed ? (
            <button
              onClick={() => setPanelClosed(false)}
              title="打开文档 / 表格 / 图像面板"
              className="flex items-center gap-1.5 rounded-full border border-line bg-sand px-2.5 py-1 text-[12px] text-clay-deep hover:bg-surface"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                {active.artifact.kind === "excel" ? (
                  <path
                    d="M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                ) : active.artifact.kind === "svg" ? (
                  <path
                    d="M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : active.artifact.kind === "image" ? (
                  <path
                    d="M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6M9 8.5a1 1 0 11-2 0 1 1 0 012 0z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zm0 0v5h5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
              {active.artifact.name}
            </button>
          ) : null}
          <div className="flex-1" />
          <button
            onClick={() => setUsageOpen(true)}
            title="Token 用量分析"
            aria-haspopup="dialog"
            aria-expanded={usageOpen}
            className="usage-trigger"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 19V5m0 14h17M8 15v-4m5 4V7m5 8V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>用量</span>
          </button>
          <button
            onClick={() => active && exportConv(active)}
            disabled={!active || streaming}
            title="导出对话 (Markdown)"
            className="rounded-lg p-1.5 text-ink-soft hover:bg-sand disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            onClick={() => setDark((v) => !v)}
            title={dark ? "切换亮色" : "切换暗色"}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-sand"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              {dark ? (
                <path
                  d="M12 4v2m0 12v2M4 12h2m12 0h2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4M7.7 16.3l-1.4 1.4M12 8.5A3.5 3.5 0 1012 15.5 3.5 3.5 0 0012 8.5z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M20.4 14.2A8.5 8.5 0 019.8 3.6a8.5 8.5 0 1010.6 10.6z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </button>
        </header>

        <div ref={scrollRef} onScroll={onChatScroll} className="flex-1 overflow-y-auto">
          {msgs.length === 0 ? (
            <div className="welcome-wrap mx-auto flex h-full max-w-4xl flex-col items-center justify-center px-6 pb-12 text-center">
              <h1 className="welcome-title mt-5 text-[30px] font-semibold">
                {greeting()}，有什么可以帮忙的？
              </h1>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-5 py-6">
              {msgs.map((m, i) => (
                <div key={i} data-message-index={i}>
                  <MessageRow
                    m={m}
                    index={i}
                    isLast={i === msgs.length - 1}
                    streaming={streaming}
                    imageBusy={imageBusy}
                    codeMode={codeMode}
                    waiting={waiting}
                    think={think}
                    onOpenPanel={openPanel}
                    onRegenerate={handleRegenerate}
                    onContinue={handleContinue}
                    onEditUser={handleEditUser}
                    onBranch={() => branchFromMessage(i)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <Composer disabled={streaming} onSend={handleSend} onStop={stop} />
      </main>

      {panel && !panelClosed ? (
        panel.kind === "word" ? (
          <DocPanel
            name={panel.name}
            md={panel.content}
            live={panel.live}
            onClose={() => setPanelClosed(true)}
            onSave={(value) => saveArtifactEdit("word", value)}
          />
        ) : panel.kind === "excel" ? (
          <SheetPanel
            name={panel.name}
            csv={panel.content}
            live={panel.live}
            onClose={() => setPanelClosed(true)}
            onSave={(value) => saveArtifactEdit("excel", value)}
          />
        ) : (
          <ImagePanel
            name={panel.name}
            code={panel.content}
            live={panel.live}
            onClose={() => setPanelClosed(true)}
          />
        )
      ) : null}

      {!panelClosed && !panel && (imageArtifact || pendingImage) ? (
        <PhotoPanel
          name={(imageArtifact ?? pendingImage)!.name}
          prompt={(imageArtifact ?? pendingImage)!.prompt}
          src={imageArtifact?.src}
          live={imageBusy}
          onRegenerate={() => {
            const info = imageArtifact ?? pendingImage;
            if (info?.prompt && active) generateImage(active.id, info.prompt, info.name);
          }}
          onClose={() => setPanelClosed(true)}
        />
      ) : null}

      {usageOpen ? (
        <TokenUsagePanel convs={convs} activeId={activeId} onClose={() => setUsageOpen(false)} />
      ) : null}
    </div>
  );
}
