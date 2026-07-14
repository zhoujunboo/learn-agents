/**
 * 基于 Redis 的 Agent 短期记忆
 *
 * 模式：
 * - invoke 前：从 Redis 读取该会话的 messages
 * - invoke 后：把 agent 返回的 messages 写回 Redis（带 TTL）
 * - 压缩：由 langchain summarizationMiddleware 在 agent 内部完成
 *
 * 前置：docker compose up -d redis
 *
 * 运行：node src/agent-with-redis-memory.mjs
 * 输入 exit / quit / :q 退出；:clear 清空当前会话记忆
 */
// 导入环境变量
import "dotenv/config";
// 导入 Redis 客户端（用于存储对话历史）
import Redis from "ioredis";
// 导入命令行交互工具（用于和用户对话）
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
// 导入 OpenAI 的语言模型
import { ChatOpenAI } from "@langchain/openai";
// 导入消息格式转换工具（在内存和 Redis 格式之间转换）
import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
// 导入创建 AI Agent 和中间件的工具
import { createAgent, HumanMessage, summarizationMiddleware } from "langchain";

// ============ Redis 连接配置 ============
// Redis 主机和端口（用于保存对话历史）
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_DB = Number(process.env.REDIS_DB ?? 0);

// 对话历史在 Redis 中保存多久（秒）。默认 30 分钟。
// 超过这个时间后，旧对话会被自动删除
const MEMORY_TTL = Number(process.env.MEMORY_TTL_SECONDS ?? 1800);

// Redis 中存储的 key 前缀（用来区分不同的应用）
const KEY_PREFIX = process.env.MEMORY_KEY_PREFIX ?? "agent:short_memory";

// 会话 ID（相当于用户身份 ID，一个用户对应一个会话）
const SESSION_ID = process.env.MEMORY_SESSION_ID ?? "demo_user_001";

// 对话内容太多时，自动生成摘要的提示词
// 这样可以压缩历史记录，节省内存和 token 成本


// 对话摘要的提示词
// 当对话记录太多时，系统会用这个提示词让 AI 自动总结对话
// 这样可以只保留重要信息，节省后续对话的 token 成本
const summaryPrompt = `你是对话摘要助手。请用中文总结以下对话，包含：
1. 讨论的主要话题
2. 用户提到的重要事实（姓名、偏好、日期等，务必保留原文信息）
3. 继续对话所需的关键上下文

保持简洁，不要编造，不要遗漏用户明确说过的信息。

待摘要的对话：
{messages}

摘要：`;

// ============ Redis 消息存储类 ============
// 这个类负责和 Redis 交互，管理对话历史的读写和删除
class RedisMessageStore {
  constructor({ redis, keyPrefix, ttlSeconds }) {
    this.redis = redis;           // Redis 客户端
    this.keyPrefix = keyPrefix;   // key 的前缀，用来区分不同应用
    this.ttlSeconds = ttlSeconds; // 数据在 Redis 中最多保存多久（秒）
  }

  // 生成 Redis 中的 key 名称
  // 格式示例：agent:short_memory:demo_user_001:messages
  messagesKey(sessionId) {
    return `${this.keyPrefix}:${sessionId}:messages`;
  }

  // 从 Redis 读取某个会话的对话历史
  async loadMessages(sessionId) {
    const raw = await this.redis.get(this.messagesKey(sessionId));
    if (!raw) return []; // 如果没有历史记录，返回空列表
    // 把 JSON 格式转换成 LangChain 能用的消息对象
    return mapStoredMessagesToChatMessages(JSON.parse(raw));
  }

  // 把对话历史保存到 Redis
  // 同时设置过期时间（TTL），超过这个时间后会自动删除
  async saveMessages(sessionId, messages) {
    // 把消息对象转换成 JSON 字符串
    const payload = JSON.stringify(mapChatMessagesToStoredMessages(messages));
    // 保存到 Redis，"EX" 表示设置过期时间（单位：秒）
    await this.redis.set(
      this.messagesKey(sessionId),
      payload,
      "EX",
      this.ttlSeconds,
    );
  }

  // 清空某个会话的对话历史
  async clear(sessionId) {
    await this.redis.del(this.messagesKey(sessionId));
  }

  // 查看某个会话的剩余过期时间
  async ttl(sessionId) {
    return this.redis.ttl(this.messagesKey(sessionId));
  }
}

// ============ 带记忆的对话函数 ============
// 这个函数执行一次 Agent 对话，并自动保存到 Redis
async function invokeWithMemory(agent, store, sessionId, userText) {
  // 第 1 步：从 Redis 读取以前的对话历史
  const history = await store.loadMessages(sessionId);
  console.log(`  ↳ 从 Redis 加载 ${history.length} 条历史`);

  // 第 2 步：把用户的新消息添加到历史，然后让 Agent 处理
  // recursionLimit 是防止 Agent 陷入无限循环的安全措施
  const result = await agent.invoke(
    { messages: [...history, new HumanMessage(userText)] },
    { recursionLimit: 30 },
  );

  // 第 3 步：把 Agent 返回的所有消息保存到 Redis
  // （包括历史 + 新的用户消息 + 助手回复，以及可能的自动摘要）
  await store.saveMessages(sessionId, result.messages);
  const ttl = await store.ttl(sessionId);
  console.log(`  ↳ 写回 Redis ${result.messages.length} 条 (TTL ${ttl}s)`);

  return result;
}

// ============ 初始化 Redis 连接 ============
const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB });

// 监听 Redis 连接状态
redis.on("connect", () => console.log("✅ Redis 已连接"));
redis.on("error", (err) => console.error("❌ Redis 错误:", err.message));

// ============ 创建消息存储实例 ============
// 这个对象负责所有和 Redis 的交互
const store = new RedisMessageStore({
  redis,
  keyPrefix: KEY_PREFIX,
  ttlSeconds: MEMORY_TTL,
});

// ============ 初始化语言模型 ============
// 使用 OpenAI 的 GPT 模型来进行对话
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0, // 温度为 0 表示回复更稳定、不随机
});

// ============ 创建 AI Agent ============
// 这是整个系统的核心，负责理解用户输入并生成回复
const agent = createAgent({
  model,
  tools: [], // 这个例子中没有使用工具，只做简单对话

  // Agent 的系统提示词，告诉 AI 它的角色和行为方式
  systemPrompt:
    "你是会话助手。记住用户提到的关键事实，中文简短回答。若消息中有对话摘要，请据此继续对话。",

  // 中间件：在对话过程中自动触发的处理逻辑
  middleware: [
    summarizationMiddleware({
      model,
      summaryPrompt,
      trigger: { messages: 8 },  // 当对话记录达到 8 条时触发摘要
      keep: { messages: 4 },     // 摘要后只保留最近的 4 条消息
    }),
  ],
});

// ============ 主循环：和用户交互 ============
console.log("输入 exit / quit / :q 退出，:clear 清空记忆\n");

// 创建命令行交互接口
const rl = readline.createInterface({ input: stdin, output: stdout });

// 记录上一次的消息数，用来判断是否发生了自动压缩
let prevCount = (await store.loadMessages(SESSION_ID)).length;

try {
  // 循环处理用户输入
  while (true) {
    // 读取用户输入
    const userText = (await rl.question("你: ")).trim();
    if (!userText) continue; // 空输入就跳过

    // 检查退出命令
    if (["exit", "quit", ":q"].includes(userText.toLowerCase())) break;

    // 检查清空记忆命令
    if (userText === ":clear") {
      await store.clear(SESSION_ID);
      prevCount = 0;
      console.log("已清空当前会话记忆\n");
      continue;
    }

    // 执行对话（从 Redis 读历史 → 调用 Agent → 保存结果）
    const { messages } = await invokeWithMemory(
      agent,
      store,
      SESSION_ID,
      userText,
    );

    // 显示 Agent 的回复（取最后一条消息）
    console.log("\n助手:", messages.at(-1)?.content);
    console.log(`当前消息数: ${messages.length}`);

    // 如果消息数没有增加太多，说明发生了自动压缩
    if (messages.length < prevCount + 2) {
      console.log("  ⚡ 已触发压缩");
    }
    prevCount = messages.length;
    console.log();
  }
} finally {
  // 关闭命令行接口
  rl.close();
}

// 断开 Redis 连接
await redis.quit();
