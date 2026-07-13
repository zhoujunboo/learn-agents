// 演示 deepagents 文件系统中间件：为 Agent 提供受权限约束的文件读写能力
import "dotenv/config"; // 加载 .env 中的环境变量（模型名、API Key 等）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, HumanMessage } from "langchain";
import { createFilesystemMiddleware, FilesystemBackend } from "deepagents";

// Agent 可操作的工作区目录（当前文件同级的 workspace 文件夹）
const workspaceDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "workspace"
);

/** 权限规则表：先匹配先生效；未命中任何规则则默认允许 */
const permissions = [
  { operations: ["read"], paths: ["/secret.txt"], mode: "deny" }, // 禁止读取 secret.txt
  { operations: ["write"], paths: ["/todo.md"], mode: "allow" },  // 允许写入 todo.md
  { operations: ["write"], paths: ["/**"], mode: "deny" },        // 禁止写入其余所有路径
];

// 每次运行前重建干净的工作区，并预置一个不可读的机密文件
fs.rmSync(workspaceDir, { recursive: true, force: true }); // 删除旧工作区
fs.mkdirSync(workspaceDir);                                 // 创建空工作区
fs.writeFileSync(path.join(workspaceDir, "secret.txt"), "机密：不得读取", "utf8");

// 初始化聊天模型（temperature=0 保证输出稳定，便于演示）
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
});

// 创建 Agent：不注册普通工具，文件操作能力全部由文件系统中间件提供
const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "工作区根路径为 /。用 ls、read_file、write_file、edit_file 操作文件，路径以 / 开头。中文回答。",
  middleware: [
    // 文件系统中间件：注入 ls/read_file/write_file/edit_file 等工具，并按 permissions 校验
    createFilesystemMiddleware({
      // virtualMode 将 workspaceDir 映射为虚拟根路径 /，对 Agent 屏蔽真实磁盘路径
      backend: new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true }),
      permissions,
    }),
  ],
});

console.log("工作区:", workspaceDir);
console.log("权限:", JSON.stringify(permissions, null, 2));

/** 运行一次 Agent 调用并打印其调用的工具名与最终回复 */
async function run(label, prompt) {
  console.log(`\n=== ${label} ===\n`, prompt, "\n");
  const { messages } = await agent.invoke(
    { messages: [new HumanMessage(prompt)] },
    { recursionLimit: 20 } // 限制最大推理步数，防止无限循环
  );
  // 遍历所有消息，打印 Agent 实际发起的工具调用
  for (const m of messages) {
    for (const t of m.tool_calls ?? []) console.log("→", t.name);
  }
  console.log("回复:", messages.at(-1)?.content); // 最后一条消息即最终回复
}

/** 运行一次预期被权限拒绝的调用；捕获并打印被拒错误 */
async function expectDenied(label, prompt) {
  console.log(`\n=== ${label}（预期拒绝）===\n`, prompt, "\n");
  try {
    await agent.invoke({ messages: [new HumanMessage(prompt)] }, { recursionLimit: 5 });
    console.log("未触发拒绝（异常）"); // 若未抛错说明权限未生效，属异常情况
  } catch (e) {
    const msg = e.cause?.message ?? e.message; // 优先取底层原因，退回外层错误信息
    console.log("✗", msg);
  }
}

// 场景一：允许的操作——写入 /todo.md 命中 allow 规则，应成功执行
await run(
  "允许的操作",
  "write_file 创建 /todo.md（三条待办），edit_file 把第一条标为完成，ls /，一句话总结。"
);

// 场景二：读取 /secret.txt 命中 deny 规则，应被拒绝
await expectDenied("禁止读", "只调用 read_file，路径 /secret.txt。");
// 场景三：写入 /hack.txt 命中 /** 兜底 deny 规则，应被拒绝
await expectDenied("禁止写", "只调用 write_file，路径 /hack.txt，内容 test。");