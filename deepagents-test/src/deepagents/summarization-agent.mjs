// 从 .env 文件读取环境变量（API key、模型名、接口地址等）
import "dotenv/config";
import fs from "node:fs"; // 读写、删除文件夹用
import path from "node:path"; // 拼接、处理文件路径用
import { fileURLToPath } from "node:url"; // 把 import.meta.url 转成普通文件路径
import { ChatOpenAI } from "@langchain/openai"; // 调用大模型的客户端
import { createAgent, HumanMessage } from "langchain"; // 创建智能体、构造用户消息
// createSummarizationMiddleware：给 agent 挂上“自动摘要”能力
// —— 当对话变长时，自动把旧消息压缩成一段摘要，省 token 又不丢关键信息
import { createSummarizationMiddleware, FilesystemBackend } from "deepagents";

// 当前文件所在目录（ESM 里没有现成的 __dirname，需要自己算）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// agent 的工作区目录，摘要生成的历史文件都存这里
const workspaceDir = path.join(__dirname, "workspace-summarization");
// 存放“被摘要掉的历史对话”的文件夹（虚拟路径，根目录是 /）
const historyPathPrefix = "/conversation_history";

// 摘要提示词：告诉模型怎么总结旧对话。{conversation} 是占位符，
// 运行时会被替换成真实的历史消息内容
const summaryPrompt = `你是对话摘要助手。请用中文总结以下对话，包含：
1. 讨论的主要话题
2. 达成的关键结论或决定
3. 继续对话所需的重要上下文

保持简洁，不要罗列无关细节。

待摘要的对话：
{conversation}

摘要：`;

// 每次运行前先把工作区清空重建，保证 demo 从干净状态开始（避免旧文件干扰）
fs.rmSync(workspaceDir, { recursive: true, force: true }); // 删掉整个目录
fs.mkdirSync(workspaceDir, { recursive: true }); // 再重新建一个空目录

// 配置大模型：模型名、密钥、接口地址都从环境变量读取
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0, // 0 表示回答尽量稳定、不随机，适合测试
});

// 文件系统后端：摘要产生的历史文件都写到 workspaceDir 里
const backend = new FilesystemBackend({
  rootDir: workspaceDir,
  virtualMode: true, // 虚拟模式：对 agent 来说根目录是 /，实际映射到 workspaceDir
});

// 创建智能体
const agent = createAgent({
  model, // 用上面配置好的大模型
  tools: [], // 没有额外自定义工具
  // systemPrompt：告诉 agent 它的角色和行为规则
  systemPrompt:
    "你是会话助手。记住用户提到的关键事实，中文简短回答。若看到「此前对话摘要」，请据此继续对话。",
  middleware: [
    // 自动摘要中间件：对话变长时自动压缩旧消息
    createSummarizationMiddleware({
      model, // 用哪个模型来生成摘要
      backend, // 摘要历史存到哪
      historyPathPrefix, // 历史文件夹路径
      summaryPrompt, // 用上面写好的摘要提示词
      // trigger：什么时候触发摘要 —— 这里设为“消息数超过 8 条”就触发
      // keep：摘要后保留最近几条原始消息 —— 这里保留最近 4 条
      // 阈值调低只是为了 demo 容易触发；生产环境可省略，让模型按 profile 自动判断
      trigger: { type: "messages", value: 8 },
      keep: { type: "messages", value: 4 },
    }),
  ],
});

// 一组按顺序发的问题：先让 agent 记 4 件事（这会让消息数增多、触发摘要），
// 最后一条检验它在“旧消息被摘要压缩”后是否还能答对全部信息
const prompts = [
  "请记住：我的宠物猫叫小橘。",
  "请记住：我住在北京。",
  "请记住：我喜欢喝拿铁。",
  "请记住：我的生日是 5 月 1 日。",
  "根据我们聊过的内容，我的猫叫什么、住哪、喜欢喝什么、生日是哪天？每项一行。",
];

// 历史文件夹在磁盘上的真实路径（把虚拟路径 /conversation_history 转成真实路径）
const historyDir = path.join(workspaceDir, historyPathPrefix.replace(/^\//, ""));

// 列出历史文件夹里当前所有文件；文件夹还不存在时返回空数组
function listHistoryFiles() {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir);
}

let messages = []; // 保存整段对话历史，多轮共享上下文
// 记录“已经见过的历史文件”，用来判断哪次对话新触发了摘要
let knownHistory = new Set(listHistoryFiles());

// 依次把每个问题发给 agent
for (const prompt of prompts) {
  console.log("\n用户:", prompt);
  // 把“历史消息 + 这次的新问题”一起发过去
  ({ messages } = await agent.invoke(
    { messages: [...messages, new HumanMessage(prompt)] },
    { recursionLimit: 30 } // 限制内部最多循环 30 步，防止死循环
  ));

  console.log("回复:", messages.at(-1)?.content); // 打印 agent 这次的回复
  console.log("当前消息数:", messages.length); // 看消息数变化，触发摘要后会明显变少

  // 检查历史文件夹有没有出现新文件：有新文件 = 这一轮触发了摘要
  const historyFiles = listHistoryFiles();
  for (const file of historyFiles) {
    if (!knownHistory.has(file)) {
      knownHistory.add(file);
      console.log("已触发摘要，历史已写入:", `${historyPathPrefix}/${file}`);
    }
  }
}

// 全部对话结束后，把生成的历史摘要文件内容打印出来查看
if (knownHistory.size > 0) {
  for (const file of knownHistory) {
    const filePath = path.join(historyDir, file);
    console.log(`\n--- ${historyPathPrefix}/${file} ---\n`, fs.readFileSync(filePath, "utf8"));
  }
} else {
  // 一个历史文件都没有，说明消息数没到阈值、没触发摘要
  console.log("\n未生成 conversation_history（可能未触发摘要阈值）");
}