# 知序 AI · 本地智能工作台

一个运行在自己电脑上的 AI 对话工作台：对话、思考过程、Word / Excel / SVG 生成、图片生成、会话备份，全部由本机模型服务完成，不依赖云端 API。

前端只负责界面与产物渲染，模型推理与图片生成分别由本机的 OpenAI 兼容服务和 sd-server 提供。

## 功能特性

- **本地模型对话**：通过 OpenAI 兼容的 `/v1/chat/completions` 接口流式（SSE）对话。
- **思考过程**：实时展示模型返回的 `reasoning_content`，并记录思考耗时。
- **Token 用量**：优先使用服务端返回的 usage；服务端不支持时按内容估算，并提供用量分析面板。
- **会话管理**：本地持久化、搜索、重命名、删除、导出 Markdown、JSON 备份与恢复。
- **文档工作区**：
  - Word：A4 纸样式实时预览，导出 `.docx`。
  - Excel：表格预览、柱状图 / 折线图 / 饼图，导出 `.xlsx`。
  - SVG：实时预览，导出 PNG 或 SVG。
- **本地文生图**：调用本机 sd-server（FLUX.2 klein）生成图片，支持按提示词重画。
- **附件读取**：在浏览器内解析 txt / md / csv / tsv / json / xml / html / log / xlsx / xls 并随消息发送。
- **语音输入**：使用 Chrome / Edge 的 Web Speech API 进行中文语音输入。
- **知识库模式**：通用 / 中医顾问 / 心理陪伴，通过请求中的 `kb` 字段交给本地服务处理。
- **界面**：亮色 / 暗色主题，适配桌面与移动端。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | React 19 + TypeScript 6 |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS 4 |
| 内容渲染 | react-markdown、remark-gfm、mermaid |
| 文档导出 | docx、xlsx |
| 代码检查 | oxlint |

## 快速开始

### 1. 准备本地服务

**对话服务**（默认 `http://127.0.0.1:8000`）：

- 实现 OpenAI 兼容的 `POST /v1/chat/completions`，支持 `stream: true` 的 SSE 响应。
- 可选返回 `choices[].delta.reasoning_content` 以展示思考过程。
- 可选支持 `stream_options.include_usage`；服务端返回 400/422 时前端会自动去掉该参数重试。
- 可选识别请求中的 `kb` 字段（`general` / `tcm` / `counselor`）。

**绘图服务**（默认 `http://127.0.0.1:1234`）：

- `GET /v1/models` 用于健康检查。
- `POST /v1/images/generations`，返回 `data[0].b64_json`。

两个服务都不属于本仓库，需要自行准备并启动。

### 2. 启动前端

```bash
npm install
npm run dev
```

打开终端提示的地址（默认 <http://localhost:5173>）。开发环境下 Vite 会把 `/v1` 代理到 `127.0.0.1:8000`，把 `/sd` 代理到 `127.0.0.1:1234`。

### 3. 构建

```bash
npm run build     # tsc -b && vite build，产物在 dist/
npm run preview   # 本地预览构建产物
```

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE` | 空（同源 `/v1`） | 对话服务地址，例如 `http://127.0.0.1:8000` |
| `VITE_SD_BASE` | `/sd` | 绘图服务地址 |

开发代理配置见 `vite.config.ts`。

> **公网部署提示**：公网 HTTP 页面直接请求本机 loopback 服务会被 Chrome 的本地网络访问策略拦截。生产环境应通过同源反向代理访问模型服务；`deploy/claude-local-ui.conf` 是一份 nginx 示例（含 SSE 关闭缓冲、`/sd` 前缀重写），实际服务地址和隧道方式需按自己的环境调整。

## 产物标记协议

模型把完整产物放在成对标记之间，标记之外只写简短说明。前端流式解析标记并实时刷新右侧面板。

| 产物 | 标记 | 内容格式 | 导出 |
| --- | --- | --- | --- |
| Word 文档 | `<<<DOC` … `DOC>>>` | Markdown | `.docx` |
| Excel 表格 | `<<<XLS` … `XLS>>>` | CSV，可用 `## 工作表名` 分节 | `.xlsx` |
| 矢量图像 | `<<<SVG` … `SVG>>>` | 自包含的 `<svg>` 代码 | `.png` / `.svg` |

具体提示词规则见 `src/lib/wordDoc.ts`。

## 目录结构

```text
src/
  api.ts          # 对话流式请求与 usage 解析
  App.tsx         # 会话状态、生成编排、产物路由
  components/     # 侧边栏、输入框、文档 / 表格 / 图像面板等
  lib/            # 文档协议、docx / xlsx / svg 导出、图表、沙箱执行
deploy/           # nginx 反向代理示例
scripts/          # Node 端导出逻辑验证脚本
public/           # 静态资源
```

## 验证

```bash
npm run lint                  # oxlint
npm run build                 # TypeScript 类型检查 + 生产构建
node scripts/test-docx.mts    # 生成 .docx 并解包断言内容
node scripts/test-xlsx.mts    # 生成 .xlsx 并解包断言内容
```

## 数据与隐私

- 对话记录与文档内容保存在浏览器 `localStorage`，不会上传到任何服务器。
- 生成的图片只保存在内存中，刷新后需用提示词重画。
- 前端不包含、也不保存任何 API Key；所有请求都发往你配置的本地服务。
- 不要把本地模型服务或绘图服务直接暴露到公网。
