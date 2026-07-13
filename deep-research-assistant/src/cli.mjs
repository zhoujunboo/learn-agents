import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { HumanMessage } from "@langchain/core/messages";

import { createIntelligenceDeskAgent, projectDir } from "./agent.mjs";

// 项目根目录，并从根目录加载 .env 环境变量
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadEnv({ path: path.join(projectRoot, ".env") });

// 递归上限：限制 Agent 单次运行的最大步数，防止死循环（可由环境变量覆盖，默认 300）
const recursionLimit = Number(process.env.RECURSION_LIMIT) || 300;

// 文件类工具集合：用于在流式输出中识别并友好展示文件操作
const FILE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "read_file",
  "ls",
  "glob",
  "grep",
]);

const EVAL_TOOL = "eval"; // 代码执行工具名
const PREVIEW_LEN = 100; // 代码预览截断长度
const RESULT_PREVIEW_LEN = 120; // 结果预览截断长度

// 打印启动横幅
function printBanner() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║              深度调研助手              ║");
  console.log("╚══════════════════════════════════════════╝\n");
}

// 读取调研主题：优先取命令行参数，否则交互式提示用户输入
async function readQuery() {
  const fromArgs = process.argv.slice(2).join(" ").trim();
  if (fromArgs) return fromArgs;

  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question("请输入调研主题: ")).trim();
  } finally {
    rl.close();
  }
}

// 根据命名空间生成步骤标签，区分主 Agent 与各子 Agent
function stepLabel(namespace, node) {
  if (namespace.length === 0) return `[主 Agent] ${node}`;
  const id = namespace[0]?.replace(/^tools:/, "subagent:") ?? namespace[0];
  return `[${id}] ${node}`;
}

// 规整展示路径：去掉开头的 / 让 /workspace/... 显示为 workspace/...
function displayPath(p) {
  return p.startsWith("/workspace/") ? p.slice(1) : p.replace(/^\/+/, "");
}

// 从工具调用参数中提取相关路径，用于日志展示；glob/grep 额外拼接匹配模式
function pathFromArgs(name, args) {
  if (!args || typeof args !== "object") return null;
  if (name === "write_file" || name === "edit_file" || name === "read_file") {
    return typeof args.file_path === "string" ? args.file_path : null;
  }
  if (name === "ls") return typeof args.path === "string" ? args.path : null;
  if (name === "glob" || name === "grep") {
    const dir = typeof args.path === "string" ? args.path : "/";
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    return pattern ? `${pattern} @ ${dir}` : dir;
  }
  return null;
}

// 解析工具参数：字符串则尝试按 JSON 解析，失败或非字符串则原样返回
function parseArgs(args) {
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }
  return args;
}

// 压缩为单行并按最大长度截断，用于日志预览
function previewText(text, maxLen) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  if (!oneLine) return "(empty)";
  return oneLine.length <= maxLen
    ? oneLine
    : `${oneLine.slice(0, maxLen - 1)}…`;
}

// 追踪 eval 工具调用：记录待处理的代码片段并即时打印预览
function trackEvalCalls(data, pendingEval) {
  for (const msg of data?.messages ?? []) {
    for (const tc of msg.tool_calls ?? []) {
      if (!tc.id || tc.name !== EVAL_TOOL) continue;
      const args = parseArgs(tc.args);
      const code =
        args && typeof args === "object" && typeof args.code === "string"
          ? args.code
          : "";
      pendingEval.set(tc.id, code);
      console.log(`  🧮 eval: ${previewText(code, PREVIEW_LEN)}`);
    }
  }
}

// 追踪文件类工具调用：以 tool_call_id 为键暂存操作名与路径，待结果返回时配对展示
function trackFileCalls(data, pending) {
  for (const msg of data?.messages ?? []) {
    for (const tc of msg.tool_calls ?? []) {
      if (!tc.id || !tc.name || !FILE_TOOLS.has(tc.name)) continue;
      const p = pathFromArgs(tc.name, parseArgs(tc.args));
      if (p) pending.set(tc.id, { name: tc.name, path: p });
    }
  }
}

// 处理工具返回结果：分别展示子 Agent 委派（task）、eval 计算与文件操作，并清理待处理映射
function logToolResults(data, pending, pendingEval) {
  for (const msg of data?.messages ?? []) {
    if (msg.type !== "tool") continue;

    // 子 Agent 委派完成：打印结果预览
    if (msg.name === "task") {
      const preview = String(msg.content).slice(0, 120).replace(/\n/g, " ");
      console.log(`  task done: ${preview}...`);
      continue;
    }

    // eval 计算返回：打印结果预览并移除对应的待处理记录
    if (msg.name === EVAL_TOOL) {
      console.log(
        `  🧮 eval → ${previewText(msg.content, RESULT_PREVIEW_LEN)}`,
      );
      if (msg.tool_call_id) pendingEval.delete(msg.tool_call_id);
      continue;
    }

    // 仅处理文件类工具
    if (!msg.name || !FILE_TOOLS.has(msg.name)) continue;

    // 优先用调用时暂存的路径；否则从返回内容中用正则回退提取
    const op = msg.tool_call_id ? pending.get(msg.tool_call_id) : undefined;
    const filePath =
      op?.path ?? String(msg.content).match(/['`](\/[^'`]+)['`]/)?.[1] ?? null;

    console.log(
      filePath ? `  ${msg.name}: ${displayPath(filePath)}` : `  ${msg.name}`,
    );
    if (msg.tool_call_id) pending.delete(msg.tool_call_id);
  }
}

// 核心运行流程：创建 Agent 并流式消费其执行过程，实时打印各节点动态
async function run(query) {
  console.log(`query: ${query}`);
  console.log(`recursionLimit: ${recursionLimit}\n`);
  console.log("─".repeat(50));

  const agent = createIntelligenceDeskAgent();
  const pending = new Map(); // 待配对的文件工具调用
  const pendingEval = new Map(); // 待配对的 eval 调用

  // streamMode=updates 逐节点增量输出；subgraphs=true 一并输出子 Agent 的子图事件
  for await (const [namespace, chunk] of await agent.stream(
    { messages: [new HumanMessage(query)] },
    { streamMode: "updates", subgraphs: true, recursionLimit },
  )) {
    for (const [node, data] of Object.entries(chunk)) {
      if (node === "model_request") {
        // 模型请求阶段：先登记本轮发起的文件/eval 调用，再打印步骤标签
        trackFileCalls(data, pending);
        trackEvalCalls(data, pendingEval);
        console.log(stepLabel(namespace, node));
      } else if (node === "tools") {
        // 工具执行阶段：打印工具返回结果
        logToolResults(data, pending, pendingEval);
      } else if (node === "todoListMiddleware.after_model") {
        // 待办列表更新阶段：打印步骤标签
        console.log(stepLabel(namespace, node));
      }
    }
  }

  console.log("─".repeat(50));
}

// 列出目录下的 Markdown 文件，按修改时间从新到旧排序
function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

// 汇总打印本次产出的文件：调研资料最多 8 条、报告最多 5 条
function printOutputs() {
  const sources = listMd(path.join(projectDir, "workspace/sources"));
  const reports = listMd(path.join(projectDir, "workspace/reports"));

  if (sources.length) {
    console.log("\n sources:");
    for (const f of sources.slice(0, 8)) {
      console.log(`   ${path.relative(projectDir, f)}`);
    }
  }
  if (reports.length) {
    console.log("\n reports:");
    for (const f of reports.slice(0, 5)) {
      console.log(`   ${path.relative(projectDir, f)}`);
    }
  }
}

// 程序入口：校验环境、读取主题、运行并输出结果，含错误处理
async function main() {
  printBanner();

  // 缺少 API Key 直接退出并提示
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("Missing OPENAI_API_KEY — copy .env.example to .env");
    process.exit(1);
  }

  const query = await readQuery();
  if (!query) {
    console.error("请提供调研主题");
    process.exit(1);
  }

  try {
    await run(query);
    printOutputs();
    console.log("\n✅ done");
  } catch (err) {
    // 针对递归上限错误给出专门提示，其余错误原样输出
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Recursion limit")) {
      console.error(
        `\n❌ recursion limit (${recursionLimit}) — set RECURSION_LIMIT in .env`,
      );
    } else {
      console.error("\n❌", err);
    }
    printOutputs();
    process.exit(1);
  }
}

// 启动并兜底捕获未处理异常
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
