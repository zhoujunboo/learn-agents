import "dotenv/config";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { ChatOpenAI } from "@langchain/openai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

//这样就可以给一段 Chain 加上 memory。
//这样就可以给一段 Chain 加上 memory。
//这样就可以给一段 Chain 加上 memory。

//最后是 RunnableWithMessageHistory，它是给 chain 加上 memory 的功能

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    "你是一个简洁、有帮助的中文助手，会用 1-2 句话回答用户问题，重点给出明确、有用的信息。",
  ],
  // 用来插入对话历史
  new MessagesPlaceholder("history"),
  ["human", "{question}"],
]);

const simpleChain = prompt.pipe(model).pipe(new StringOutputParser());

//  在 map 里管理每个 sessionId 对应的 ChatMessageHistory
const messageHistories = new Map();

const getMessageHistory = (sessionId) => {
  if (!messageHistories.has(sessionId)) {
    messageHistories.set(sessionId, new InMemoryChatMessageHistory());
  }
  return messageHistories.get(sessionId);
};

// 然后创建 RunnableWithMessageHistory 的 chain，告诉它问题、回答都是从哪个字段取
// 创建带消息历史的链
const chain = new RunnableWithMessageHistory({
  runnable: simpleChain,
  getMessageHistory: (sessionId) => getMessageHistory(sessionId),
  inputMessagesKey: "question",
  historyMessagesKey: "history",
});

// 测试：第一次对话
console.log("--- 第一次对话（提供信息） ---");
const result1 = await chain.invoke(
  {
    question: "我的名字是神光，我来自山东，我喜欢编程、写作、金铲铲。",
  },
  {
    configurable: {
      sessionId: "user-123",
    },
  },
);

console.log("问题: 我的名字是神光，我来自山东，我喜欢编程、写作、金铲铲。");
console.log("回答:", result1);
console.log();

// --- 第一次对话（提供信息） ---
// 问题: 我的名字是神光，我来自山东，我喜欢编程、写作、金铲铲。
// 回答: 很高兴认识你，神光！你来自山东，喜欢编程、写作和金铲铲，我记住了；之后如果你想聊技术、写东西，或者研究阵容，我都可以帮你。

// 测试：第二次对话
console.log("--- 第二次对话（询问之前的信息） ---");
const result2 = await chain.invoke(
  {
    question: "我刚才说我来自哪里？",
  },
  {
    configurable: {
      sessionId: "user-123",
    },
  },
);
console.log("问题: 我刚才说我来自哪里？");
console.log("回答:", result2);
console.log();

// --- 第二次对话（询问之前的信息） ---
// 问题: 我刚才说我来自哪里？
// 回答: 你刚才说你来自山东。

// 测试：第三次对话
console.log("--- 第三次对话（继续询问） ---");
const result3 = await chain.invoke(
  {
    question: "我的爱好是什么？",
  },
  {
    configurable: {
      sessionId: "user-123",
    },
  },
);
console.log("问题: 我的爱好是什么？");
console.log("回答:", result3);
console.log();

// --- 第三次对话（继续询问） ---
// 问题: 我的爱好是什么？
// 回答: 你的爱好是编程、写作和金铲铲。
