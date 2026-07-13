// 演示 deepagents 的「子 Agent（subAgent）」中间件：
// 主 Agent 自己不干活，而是把任务拆开，依次委派给多个各有专长的子 Agent
// 场景：小学应用题辅导 —— 解题 → 讲题 → 出题
import "dotenv/config"; // 加载 .env 环境变量
import { z } from "zod"; // 用于定义工具参数的类型校验
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, HumanMessage, tool } from "langchain";
import { createSubAgentMiddleware } from "deepagents";

/** 工具一：四则运算，供解题子 Agent 列式计算，避免模型心算出错 */
const calc = tool(
  ({ a, b, op }) => {
    // 按运算类型算出结果（除法特判除数为 0，返回 NaN）
    const ops = {
      add: a + b,
      subtract: a - b,
      multiply: a * b,
      divide: b === 0 ? NaN : a / b,
    };
    const result = ops[op];
    if (Number.isNaN(result)) {
      return JSON.stringify({ error: "除数不能为 0" });
    }
    // 把运算类型转成数学符号，拼出可读的算式一起返回
    const symbols = { add: "+", subtract: "-", multiply: "×", divide: "÷" };
    return JSON.stringify({
      expression: `${a} ${symbols[op]} ${b}`,
      result,
    });
  },
  {
    // 工具的名称、描述和参数定义（描述会告诉模型这个工具能做什么）
    name: "calc",
    description: "计算两个数的加减乘除",
    schema: z.object({
      a: z.number().describe("左操作数"),
      b: z.number().describe("右操作数"),
      op: z.enum(["add", "subtract", "multiply", "divide"]).describe("运算类型"),
    }),
  }
);

/** 工具二：平均分（总数 ÷ 份数），并说明是否能整除 */
const divideEvenly = tool(
  ({ total, parts }) => {
    if (parts <= 0) {
      return JSON.stringify({ error: "份数须大于 0" });
    }
    const each = total / parts;
    const exact = Number.isInteger(each); // 判断是否正好整除
    return JSON.stringify({
      total,
      parts,
      each,
      exact,
      // 根据能否整除给出不同的文字说明，方便应用题描述
      note: exact
        ? `每人 ${each}（整除）`
        : `每人 ${each}（不能整除，应用题可说明余数）`,
    });
  },
  {
    name: "divide_evenly",
    description: "把总数平均分成若干份，求每份多少",
    schema: z.object({
      total: z.number().nonnegative().describe("总数"),
      parts: z.number().int().positive().describe("分成几份"),
    }),
  }
);

/** 工具三：按模板生成同类练习题（题型不变，只用 seed 换里面的数字） */
const makeSimilarProblem = tool(
  ({ template, seed }) => {
    const n = (seed % 7) + 3; // 由种子算出一个 3~9 的数字，代入题目
    // 三种题型模板，每个都有题干 stem 和解题提示 hint
    const problems = {
      divide_then_add: {
        stem: `小红有 ${n * 6} 张贴纸，平均分给 ${n} 个小组，又买了 2 包每包 ${n + 2} 张的。每个小组现在一共有多少张？`,
        hint: "先平均分，再加上后来买的，注意单位是「每个小组」",
      },
      share_candy: {
        stem: `小刚有 ${n * 4} 块糖，要分给 ${n} 位同学，妈妈又买了 3 袋每袋 ${n} 块的。每位同学现在能分到多少块？`,
        hint: "与分糖题类似：先平分，再加上新增",
      },
      group_buy: {
        stem: `班里有 ${n} 个小组，每组先分到 ${n * 5} 支铅笔，老师又补了 2 盒每盒 ${n + 1} 支。每个小组现在有多少支？`,
        hint: "先算每组原有，再加上后来补的",
      },
    };
    // 选中指定模板；模板名不认识时退回到 share_candy
    const picked = problems[template] ?? problems.share_candy;
    return JSON.stringify({ template, ...picked });
  },
  {
    name: "make_similar_problem",
    description:
      "生成一道同类应用题。template: divide_then_add | share_candy | group_buy",
    schema: z.object({
      template: z
        .enum(["divide_then_add", "share_candy", "group_buy"])
        .describe("题目模板"),
      seed: z.number().int().describe("随机种子，用于变换数字"),
    }),
  }
);

// 初始化聊天模型（temperature=0 输出稳定；streaming=true 流式输出，边生成边显示）
const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
  temperature: 0,
  streaming: true,
});

// 定义三个子 Agent：各自有名字、职责描述（description）、人设提示词和可用工具
// 主 Agent 会根据 description 判断该把任务交给谁
const subagents = [
  {
    // 子 Agent 1：解题 —— 只负责列式计算，必须用工具、不许心算
    name: "math-solver",
    description:
      "解小学应用题：用 calc、divide_evenly 列式计算，给出最终答案与算式。有具体数字时先用此 Agent。",
    systemPrompt: [
      "你是解题子 Agent。",
      "必须用 calc、divide_evenly 完成计算，不要心算。",
      "输出：题目理解、分步算式、最终答案（带单位「块/人」等）。",
    ].join("\n"),
    tools: [calc, divideEvenly], // 拥有计算工具
  },
  {
    // 子 Agent 2：讲题 —— 把解题过程讲给家长听，不用工具
    name: "kid-tutor",
    description:
      "把 math-solver 的解法讲给家长听，方便辅导孩子。description 里会有完整解题过程。",
    systemPrompt: [
      "你是辅导讲解子 Agent，面向小学生家长。",
      "根据 description 中的解题过程，用短句、比喻或分步提问方式讲解（不要堆公式）。",
      "说明：先想什么、再算什么、怎么检查答案。不使用工具。",
    ].join("\n"),
    tools: [], // 纯讲解，无需工具
  },
  {
    // 子 Agent 3：出题 —— 用出题工具生成同类练习题
    name: "practice-maker",
    description:
      "出 2 道同类练习题。用 make_similar_problem 生成题干，可换不同 template 或 seed。",
    systemPrompt: [
      "你是出题子 Agent。",
      "调用 make_similar_problem 至少 2 次（不同 template 或不同 seed），",
      "每道题给出：题干、解题提示（一句话）。",
    ].join("\n"),
    tools: [makeSimilarProblem], // 拥有出题工具
  },
];

// 创建主 Agent：它自己不带工具，只负责「调度」——通过 task 把活派给子 Agent
const agent = createAgent({
  model,
  tools: [],
  systemPrompt: [
    "你是小学数学辅导主 Agent，通过 task 委派子 Agent，自己不解题、不讲题、不出题。",
    "按顺序：① math-solver ② kid-tutor（把 solver 完整过程写进 description）③ practice-maker。",
    "最后向家长汇总：答案、辅导要点、两道练习题。中文。",
  ].join("\n"),
  middleware: [
    // 子 Agent 中间件：把上面定义的 subagents 挂到主 Agent 上，使其可被委派
    createSubAgentMiddleware({
      defaultModel: model,           // 子 Agent 默认使用的模型
      subagents,                     // 可调度的子 Agent 列表
      generalPurposeAgent: false,    // 关闭「通用兜底子 Agent」，强制只用我们定义的三个
    }),
  ],
});

// 用户的任务：给出一道应用题，并要求依次经过 解题 → 讲题 → 出题 三步
const prompt = [
  "孩子遇到这道题：",
  "「小明有 24 块糖，平均分给 6 个同学；",
  "妈妈又买了 3 包糖，每包 5 块。每个同学现在一共有多少块？」",
  "请先 math-solver 解题，再 kid-tutor 教家长怎么讲，",
  "最后 practice-maker 出 2 道类似练习题，并汇总给我。",
].join("");

// 工具函数：从流式数据块里安全地取出纯文本（兼容字符串和数组两种格式）
function chunkText(chunk) {
  if (!chunk?.content) return "";
  if (typeof chunk.content === "string") return chunk.content;
  if (Array.isArray(chunk.content)) {
    return chunk.content
      .map((p) => (typeof p === "string" ? p : (p?.text ?? "")))
      .join("");
  }
  return "";
}

// 打印本次场景说明与三个子 Agent 各自的工具，方便阅读输出
console.log("场景: 小学应用题辅导（解题 → 讲题 → 出题）");
console.log("子 Agent:");
console.log("  math-solver     → calc, divide_evenly");
console.log("  kid-tutor       → （讲解，无工具）");
console.log("  practice-maker  → make_similar_problem");
console.log();

console.log("用户:", prompt, "\n");
console.log("--- 流式输出 ---\n");

// 以事件流方式运行主 Agent；recursionLimit: 60 给多轮委派留足步数
const stream = await agent.streamEvents(
  { messages: [new HumanMessage(prompt)] },
  { recursionLimit: 60 }
);

try {
  // 遍历事件流：实时打印模型文本，以及每次工具/子 Agent 的调用名
  for await (const event of stream) {
    if (event.event === "on_chat_model_stream") {
      const t = chunkText(event.data?.chunk); // 模型逐字输出
      if (t) process.stdout.write(t);
    }
    if (event.event === "on_tool_start") {
      const name = event.name?.split("/").pop() ?? event.name; // 只取名字最后一段
      process.stdout.write(`\n\n→ ${name}\n\n`);
    }
  }
} catch (e) {
  console.error("\n\n[错误]", e.cause?.message ?? e.message);
  throw e;
}

console.log("\n");