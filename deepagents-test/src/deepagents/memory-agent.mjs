// 从 .env 文件读取环境变量（比如 API key、模型名等），import 后自动生效
import "dotenv/config";
import fs from "node:fs"; // 读写文件用
import path from "node:path"; // 拼接、处理文件路径用
import { fileURLToPath } from "node:url"; // 把 import.meta.url 转成普通文件路径
import { ChatOpenAI } from "@langchain/openai"; // 调用大模型的客户端
import { createAgent, HumanMessage } from "langchain"; // 创建智能体、构造用户消息
import {
  createFilesystemMiddleware, // 给 agent 提供“文件系统”能力（ls/读/写/改文件）
  createMemoryMiddleware, // 给 agent 提供“长期记忆”能力（把内容存进指定文件）
  FilesystemBackend, // 文件系统的底层实现（决定文件实际存哪）
} from "deepagents";

// 当前文件所在目录（ESM 模块里没有现成的 __dirname，需要自己算出来）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// agent 的“工作区”根目录，它读写的文件都放在这个文件夹里
const workspaceDir = path.join(__dirname, "workspace-memory");
// 记忆文件路径（注意这是工作区里的“虚拟路径”，根目录用 / 表示）
const projectMemoryPath = "/AGENTS.md"; // 存项目相关信息
const preferencesMemoryPath = "/memory/preferences.md"; // 存用户个人偏好

// 配置大模型：模型名、密钥、接口地址都从环境变量读取
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0, // 0 表示回答尽量稳定、不随机，适合做测试
});

// 创建文件系统后端：agent 的所有文件操作都落到 workspaceDir 这个目录
const backend = new FilesystemBackend({
  rootDir: workspaceDir,
  virtualMode: true, // 虚拟模式：对 agent 来说根目录是 /，实际映射到 workspaceDir
});

// 创建智能体
const agent = createAgent({
  model, // 用上面配置好的大模型
  tools: [], // 没有额外自定义工具，文件工具由下面的中间件提供
  // systemPrompt：给 agent 立“规矩”，告诉它怎么干活、把记忆写到哪
  systemPrompt: [
    "你是项目助手。工作区根路径为 /，可用 ls、read_file、write_file、edit_file。",
    "根据 <agent_memory> 回答；用户要求记住时，必须立刻 edit_file，且按类型写入对应文件：",
    `- ${projectMemoryPath}：项目说明、技术栈、架构、仓库约定等`,
    `- ${preferencesMemoryPath}：用户个人偏好（语言、包管理器、回答风格等）`,
    "不要混写：项目事实不要写入 preferences，个人偏好不要写入 AGENTS.md。",
  ].join("\n"),
  // middleware：给 agent 挂载额外能力
  middleware: [
    createFilesystemMiddleware({ backend }), // 文件读写能力
    createMemoryMiddleware({
      backend,
      // sources：每次对话前，自动把这些文件的内容注入到 <agent_memory> 里供 agent 参考
      sources: [projectMemoryPath, preferencesMemoryPath],
    }),
  ],
});

// 一组按顺序发给 agent 的问题，用来演示“记忆”效果：
// 先问项目、再让它记两件事、最后检验它是否真的记住了
const prompts = [
  "根据记忆，这个项目是做什么的？只答一句。",
  `请记住：我常用的包管理器是 pnpm。`, // 这条应写入 preferences.md
  `请记住：本仓库主入口脚本是 src/deepagents/memory-agent.mjs。`, // 这条应写入 AGENTS.md
  "我常用什么包管理器？本 demo 主入口脚本路径是什么？各用一行回答。",
];

// messages 保存整段对话历史，让 agent 有上下文（多轮对话共享）
let messages = [];

// 依次把每个问题发给 agent，并打印它的回复
for (const prompt of prompts) {
  console.log("\n用户:", prompt);
  // 把“历史消息 + 这次的新问题”一起发给 agent
  ({ messages } = await agent.invoke(
    { messages: [...messages, new HumanMessage(prompt)] },
    { recursionLimit: 30 } // 限制 agent 内部最多循环 30 步，防止死循环
  ));
  // messages.at(-1) 取最后一条消息，也就是 agent 这次的回复
  console.log("回复:", messages.at(-1)?.content);
}

// 对话结束后，直接读出两个记忆文件的真实内容，验证 agent 确实写进去了
for (const p of [projectMemoryPath, preferencesMemoryPath]) {
  // 把虚拟路径（如 /AGENTS.md）转成磁盘上的真实路径
  const file = path.join(workspaceDir, p.replace(/^\//, ""));
  console.log(`\n--- ${p} ---\n`, fs.readFileSync(file, "utf8"));
}