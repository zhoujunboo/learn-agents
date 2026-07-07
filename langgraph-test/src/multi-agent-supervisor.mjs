import "dotenv/config";
import { HumanMessage } from "@langchain/core/messages";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";

import { lookupCityTrivia, lookupWeather } from "./simple-mock.mjs";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const lookupWeatherTool = tool(async ({ city }) => lookupWeather(city), {
  name: "lookup_weather",
  description: "查询某城市当日天气概况（气温区间、天气、空气质量等）。",
  schema: z.object({
    city: z.string().describe("城市名，如 杭州"),
  }),
});

const lookupCityTriviaTool = tool(async ({ city }) => lookupCityTrivia(city), {
  name: "lookup_city_trivia",
  description: "查询与某城市相关的一句趣味知识。",
  schema: z.object({
    city: z.string().describe("城市名，如 杭州"),
  }),
});

/** 子代理 A：只回答「天气」类问题 */
const weatherAgent = createAgent({
  name: "weather_agent",
  description: "专门查天气",
  model,
  tools: [lookupWeatherTool],
  systemPrompt:
    "你只处理天气。用户提到城市时，用 lookup_weather 查询后再用中文简短说明。",
});

/** 子代理 B：只回答「城市小知识」 */
const triviaAgent = createAgent({
  name: "trivia_agent",
  description: "专门讲与城市相关的小知识；必须调用 lookup_city_trivia。",
  model,
  tools: [lookupCityTriviaTool],
  systemPrompt:
    "你只讲城市小知识。先 lookup_city_trivia，再用人话转述，不要编造工具里没有的内容。",
});

/**
 * Supervisor：根据用户问的是「天气」还是「小知识」切换子代理。
 * （真实业务里还可以再加更多子代理，思路一样。）
 */
const workflow = createSupervisor({
  agents: [weatherAgent.graph, triviaAgent.graph],
  llm: model,
  addHandoffMessages: false,
  addHandoffBackMessages: true,
  includeAgentName: "inline",
  prompt: `你是调度员，只负责选人，不要自己报气温、也不要自己讲城市百科。

- 问天气、气温、下不下雨、空气 → 用 weather_agent
- 问小知识、名胜、历史、一句介绍 → 用 trivia_agent
- 如果用户同时问多个事项，分别交给对应子代理；同一个事项不要重复交给同一个子代理。
- 当 weather_agent 和 trivia_agent 都已经给出结果后，用中文汇总最终答案并停止，不要再调用任何工具或子代理。
`,
});

const app = workflow.compile();

const drawable = await app.getGraphAsync();
console.log(drawable.drawMermaid({ withStyle: true }));

const input = {
  messages: [
    new HumanMessage("查一下杭州的天气，再讲一条和杭州有关的小知识。"),
  ],
};

// ---- 流式执行 & 追踪 ----
// streamMode: ["updates", "values"] 让每次事件返回 [mode, payload] 二元组
//   "updates" → 哪个节点刚跑完，如 { weather_agent: { ... } }
//   "values"  → 当前完整状态快照
const nodePath = []; // 记录节点执行路径
let finalState = null; // 存最终完整状态

const stream = await app.stream(input, { streamMode: ["updates", "values"] });
for await (const event of stream) {
  const [mode, payload] = event;

  if (mode === "updates" && payload && typeof payload === "object") {
    // payload 的 key 就是刚执行完的节点名
    nodePath.push(...Object.keys(payload));
  } else if (mode === "values") {
    // 最后一次 values 事件 = 最终状态
    finalState = payload;
  }
}

console.log("路径:", nodePath.join(" → "));
const last = finalState?.messages?.at(-1);
console.log(last?.content ?? finalState?.messages);

// 路径: supervisor → weather_agent → supervisor → trivia_agent → supervisor
// 杭州天气：今天多云转小雨，约 15–22℃，空气质量良，建议带伞。
// 杭州小知识：杭州的西湖文化景观已被列入世界文化遗产。
