/**
 * Redis 记这轮聊天，Mem0 记值得长期留着的事。
 *
 * 用户层 = 换天聊还认得你；会话层 = 只管当前这个聊天窗口。
 *
 * docker compose up -d redis 后 pnpm agent
 * :clear 清 Redis | :clear-mem0 清 Mem0 | exit/:q 退出
 */
import "dotenv/config";
import Redis from "ioredis";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { MemoryClient } from "mem0ai";
import { ChatOpenAI } from "@langchain/openai";
import {
  SystemMessage,
  SystemMessageChunk,
  HumanMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import { createAgent, summarizationMiddleware } from "langchain";

const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const REDIS_DB = Number(process.env.REDIS_DB ?? 0);
const MEMORY_TTL = Number(process.env.MEMORY_TTL_SECONDS ?? 1800);
const KEY_PREFIX = process.env.MEMORY_KEY_PREFIX ?? "agent:short_memory";

// const USER_ID = process.env.MEM0_USER_ID ?? "demo_user_001";
const USER_ID =  "demo_user_002";

const SESSION_ID = "session_003";
const MEM0_TOP_K = Number(process.env.MEM0_TOP_K ?? 5);

const memorySchema = z.object({
  write_user: z
    .boolean()
    .describe(
      "写入用户层：换一个新会话仍应保留的长期事实（身份、居住地、长期爱好、饮食禁忌、持久偏好）。不含仅本轮任务。",
    ),
  write_session: z
    .boolean()
    .describe(
      "写入会话层：仅当前会话/thread 有效的任务、大纲、进度、待办、临时决策（如「这次先写…」「数据部分明天补」）。",
    ),
  reason: z.string().describe("分类理由，一句话"),
});

const CLASSIFIER_PROMPT = `你是记忆分层分类器。判断本轮对话是否有「新事实」需写入 Mem0，并分到正确层级。

## user 层（跨会话长期）
- 用户身份与画像：姓名、职业、居住地、长期爱好
- 长期偏好与约束：饮食过敏、回答风格、常用技术栈
- 持续数周以上的个人背景（非单次任务）

## session 层（仅当前会话）
- 当前正在做的任务、目标、文档大纲、方案草稿
- 本会话内的进度、决策、待办、临时约定
- 用户明确用「这次」「本轮」「当前会话」描述的工作上下文

## 均不写入
- 寒暄、致谢、纯确认
- 助手生成的通用内容（攻略、示例代码、建议清单），用户未明确采纳为新事实
- 无信息增量的复述

## 决策原则
1. 「这次我们先写 Q1 总结」「当前在排查 XX」→ 优先 session，不要标成 user
2. user 与 session 可同时为 true（如同时说职业+当前任务），但勿把纯会话任务只标 user
3. 一次性请求（如「帮我做旅行攻略」）且未产生需跨轮记住的约定 → 均为 false`;

const summaryPrompt = `你是对话摘要助手。用中文简洁总结：话题、会话内进度/报错/待办。
用户级长期偏好由外部记忆维护，摘要勿重复堆砌。不要编造。

待摘要的对话：
{messages}

摘要：`;

// 筛选掉系统消息，只保存对话内容到 Redis（系统消息是临时的，不需要持久化）
function messagesForRedis(messages) {
  return messages.filter(
    (m) => !SystemMessage.isInstance(m) && !SystemMessageChunk.isInstance(m),
  );
}

// Redis 短期记忆存储类 —— 管理当前会话的聊天记录，自动过期
class RedisMessageStore {
  constructor({ redis, keyPrefix, ttlSeconds }) {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
    this.ttlSeconds = ttlSeconds;
  }

  // 生成 Redis 键名，格式：前缀:会话ID:messages
  messagesKey(sessionId) {
    return `${this.keyPrefix}:${sessionId}:messages`;
  }

  // 从 Redis 读取当前会话的所有聊天记录
  async loadMessages(sessionId) {
    const raw = await this.redis.get(this.messagesKey(sessionId));
    if (!raw) return [];
    return mapStoredMessagesToChatMessages(JSON.parse(raw));
  }

  // 把聊天记录保存到 Redis，并设置自动过期时间
  async saveMessages(sessionId, messages) {
    const payload = JSON.stringify(mapChatMessagesToStoredMessages(messages));
    await this.redis.set(
      this.messagesKey(sessionId),
      payload,
      "EX",
      this.ttlSeconds,
    );
  }

  // 清空某个会话的所有聊天记录
  async clear(sessionId) {
    await this.redis.del(this.messagesKey(sessionId));
  }

  // 查询当前会话记录还有多少秒就过期
  async ttl(sessionId) {
    return this.redis.ttl(this.messagesKey(sessionId));
  }
}

// Mem0 长期记忆存储类 —— 管理用户级和会话级的重要信息，自动分类和检索
class Mem0MemoryStore {
  constructor({ client, userId, sessionId, topK, classifier }) {
    this.client = client;
    this.userId = userId;
    this.sessionId = sessionId;
    this.topK = topK;
    this.classifier = classifier;
  }

  // 同时从用户层和会话层搜索相关记忆，返回两层的结果
  async search(query) {
    const [userRes, sessionRes] = await Promise.all([
      this.client.search(query, {
        filters: { user_id: this.userId },
        topK: this.topK,
      }),
      this.client.search(query, {
        filters: {
          AND: [{ user_id: this.userId }, { run_id: this.sessionId }],
        },
        topK: this.topK,
      }),
    ]);
    return {
      user: userRes.results ?? [],
      session: sessionRes.results ?? [],
    };
  }

  // 组装系统消息：把用户层和会话层的记忆以格式化文本注入给 AI
  buildSystemMessage({ user, session }) {
    const blocks = [];
    if (user.length) {
      blocks.push(
        `【用户长期记忆】\n${user.map((m) => `- ${m.memory}`).join("\n")}`,
      );
    }
    if (session.length) {
      blocks.push(
        `【当前会话记忆】\n${session.map((m) => `- ${m.memory}`).join("\n")}`,
      );
    }
    if (!blocks.length) return null;
    return new SystemMessage(
      `${blocks.join("\n\n")}\n\n请结合以上记忆回答，勿编造。`,
    );
  }

  // 用 AI 分类当前对话，决定是否要写入 Mem0 及写入哪一层（用户层或会话层）
  async classifyAndPersist(userText, assistantText) {
    const turn = [
      { role: "user", content: userText },
      { role: "assistant", content: assistantText },
    ];

    const { write_user, write_session, reason } = await this.classifier.invoke([
      new SystemMessage(CLASSIFIER_PROMPT),
      new HumanMessage(`用户：${userText}\n助手：${assistantText}`),
    ]);

    const written = [];
    if (write_user) {
      await this.client.add(turn, { userId: this.userId });
      written.push("user");
    }
    if (write_session) {
      await this.client.add(turn, {
        userId: this.userId,
        runId: this.sessionId,
      });
      written.push("session");
    }
    return { written, reason };
  }

  // 清空用户的所有长期记忆和当前会话的记忆
  async clear() {
    await this.client.deleteAll({ userId: this.userId });
    await this.client.deleteAll({ userId: this.userId, runId: this.sessionId });
  }
}

// 主处理函数：从 Redis 读历史 → 从 Mem0 读记忆 → 调用 Agent → 保存到双存储 → 分类新事实
async function invokeWithMemory(
  agent,
  redisStore,
  mem0Store,
  sessionId,
  userText,
) {
  // 第一步：从 Redis 读取当前会话的聊天历史
  const history = await redisStore.loadMessages(sessionId);
  console.log(`  ↳ Redis 加载 ${history.length} 条历史`);

  // 第二步：从 Mem0 搜索相关的用户级和会话级记忆
  const mem = await mem0Store.search(userText);
  if (mem.user.length) console.log(`  ↳ Mem0 用户层 ${mem.user.length} 条`);
  if (mem.session.length)
    console.log(`  ↳ Mem0 会话层 ${mem.session.length} 条`);

  // 第三步：组装消息：记忆系统提示 + 历史对话 + 新问题，一起送给 Agent
  const memoryMsg = mem0Store.buildSystemMessage(mem);
  const invokeMessages = [
    ...(memoryMsg ? [memoryMsg] : []),
    ...history,
    new HumanMessage(userText),
  ];

  // 第四步：调用 Agent，得到完整的对话消息列表
  const result = await agent.invoke(
    { messages: invokeMessages },
    { recursionLimit: 30 },
  );

  // 第五步：过滤掉临时系统消息，保存对话内容到 Redis
  const redisMessages = messagesForRedis(result.messages);
  const dropped = result.messages.length - redisMessages.length;
  await redisStore.saveMessages(sessionId, redisMessages);
  const ttl = await redisStore.ttl(sessionId);
  console.log(
    `  ↳ Redis 写回 ${redisMessages.length} 条` +
      (dropped ? `（过滤 ${dropped} 条 SystemMessage）` : "") +
      ` (TTL ${ttl}s)`,
  );

  // 第六步：用 AI 分类刚才的对话，决定要不要保存到 Mem0（以及保存到哪一层）
  const assistantText = String(result.messages.at(-1)?.content ?? "");
  const { written, reason } = await mem0Store.classifyAndPersist(
    userText,
    assistantText,
  );
  console.log(`  ↳ 分类: ${reason}`);
  console.log(
    written.length ? `  ↳ Mem0 写入: ${written.join(", ")}` : "  ↳ Mem0 未写入",
  );

  return { messages: result.messages, redisMessages, assistantText };
}

if (!process.env.MEM0_API_KEY || !process.env.OPENAI_API_KEY) {
  console.error("需要 MEM0_API_KEY 与 OPENAI_API_KEY");
  process.exit(1);
}

const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db: REDIS_DB });
const mem0 = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });

redis.on("connect", () => console.log("✅ Redis 已连接"));
redis.on("error", (err) => console.error("❌ Redis 错误:", err.message));

try {
  await redis.ping();
} catch {
  console.error("Redis 未连接，请先执行: docker compose up -d redis");
  process.exit(1);
}

const redisStore = new RedisMessageStore({
  redis,
  keyPrefix: KEY_PREFIX,
  ttlSeconds: MEMORY_TTL,
});

const llmOpts = {
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
};

const model = new ChatOpenAI({ model: process.env.MODEL_NAME, ...llmOpts });

const classifier = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  ...llmOpts,
}).withStructuredOutput(memorySchema);

const mem0Store = new Mem0MemoryStore({
  client: mem0,
  userId: USER_ID,
  sessionId: SESSION_ID,
  topK: MEM0_TOP_K,
  classifier,
});

const agent = createAgent({
  model,
  tools: [],
  systemPrompt:
    "你是会话助手。结合系统消息中的长期/会话记忆回答，中文简短。有对话摘要则据此继续。",
  middleware: [
    summarizationMiddleware({
      model,
      summaryPrompt,
      trigger: { messages: 8 },
      keep: { messages: 4 },
    }),
  ],
});

console.log(`用户 ${USER_ID} | 会话 ${SESSION_ID}`);
console.log(
  "输入 exit / quit / :q 退出；:clear 清空 Redis；:clear-mem0 清空 Mem0\n",
);

const rl = readline.createInterface({ input: stdin, output: stdout });
let prevCount = (await redisStore.loadMessages(SESSION_ID)).length;

try {
  while (true) {
    const userText = (await rl.question("你: ")).trim();
    if (!userText) continue;

    if (["exit", "quit", ":q"].includes(userText.toLowerCase())) break;

    if (userText === ":clear") {
      await redisStore.clear(SESSION_ID);
      prevCount = 0;
      console.log("已清空 Redis 短期记忆\n");
      continue;
    }

    if (userText === ":clear-mem0") {
      await mem0Store.clear();
      console.log("已清空 Mem0 用户层与当前会话层\n");
      continue;
    }

    const { redisMessages, assistantText } = await invokeWithMemory(
      agent,
      redisStore,
      mem0Store,
      SESSION_ID,
      userText,
    );

    console.log("\n助手:", assistantText);
    console.log(`Redis 消息数: ${redisMessages.length}`);
    if (redisMessages.length < prevCount + 2) {
      console.log("  ⚡ 已触发压缩");
    }
    prevCount = redisMessages.length;
    console.log();
  }
} finally {
  rl.close();
}

await redis.quit();

/*
 * 测试对话（复制进终端，先来 :clear-mem0 和 :clear）
 *
 * 一、寒暄
 * 你好 / 在吗 / 谢谢
 * → 纯客套，Mem0 不用记。
 *
 * 二、自我介绍
 * 我叫小明，住在杭州，平时喜欢骑行和摄影。
 * 我对海鲜过敏，出差尽量别安排沿海城市。
 * → 换天聊还得知道的事，写 user 层。
 *
 * 三、这会儿在干嘛
 * 这次我们先写 Q1 季度总结，大纲分三块：项目复盘、数据指标、下季度计划。
 * 项目复盘里重点写 order-service 的 500 错误排查过程。
 * → 只管这次聊天的事，写 session 层。
 *
 * 四、长期背景 + 手头活
 * 我长期做后端开发，这次会话的任务是排查 payment-api 超时，先从 P99 日志看起。
 * 另外我之后技术回答都希望带代码示例，这个一直记住。
 * → 职业和当前任务可能两层都写，偏好那条走 user。
 *
 * 五、Redis 和 Mem0 各管啥
 * 刚才说的 payment-api，超时阈值先假设 3 秒。
 * 上一句我说的阈值是多少？
 * → 刚说过的话 Redis 兜得住，不用等 Mem0。
 *
 * 重启 agent（别清 mem0）再问：我是谁？有什么过敏？
 * → 新会话 Redis 是空的，user 层还能认出你。
 *
 * 六、聊多了会压缩（可选，连聊 8 轮以上）
 * 继续完善 Q1 总结 / 把第二段改短 / 加个标题……
 * → 终端会出现「已触发压缩」，老消息变摘要。
 *
 * 推荐顺序：清空 → 寒暄 → 自我介绍 → 当前任务 → 重启验 user → 清 mem0 验 session 没了
 */
