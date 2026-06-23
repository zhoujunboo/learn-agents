import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";
import { z } from "zod";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 定义结构化输出的 schema
const scientistSchema = z.object({
  name: z.string().describe("科学家的全名"),
  birth_year: z.number().describe("出生年份"),
  death_year: z.number().optional().describe("去世年份，如果还在世则不填"),
  nationality: z.string().describe("国籍"),
  fields: z.array(z.string()).describe("研究领域列表"),
  achievements: z.array(z.string()).describe("主要成就"),
  biography: z.string().describe("简短传记"),
});

// 绑定工具到模型
const modelWithTool = model.bindTools([
  {
    name: "extract_scientist_info",
    description: "提取和结构化科学家的详细信息",
    schema: scientistSchema,
  },
]);

// 1. 绑定工具并挂载解析器
const parser = new JsonOutputToolsParser();
const chain = modelWithTool.pipe(parser);

try {
  // 2. 开启流
  const stream = await chain.stream("详细介绍牛顿的生平和成就");

  let lastContent = ""; // 记录已打印的完整内容
  let finalResult = null; // 存储最终的完整结果

  console.log("📡 实时输出流式内容:\n");

  for await (const chunk of stream) {
    if (chunk.length > 0) {
      //   const toolCall = chunk[0]; // 获取当前工具调用的完整参数内容
      //   const currentContent = JSON.stringify(toolCall.args || {}, null, 2);
      //   if (currentContent.length > lastContent.length) {
      //     const newText = currentContent.slice(lastContent.length);
      //     process.stdout.write(newText); // 实时输出到控制台
      //     lastContent = currentContent; // 更新已读进度
      //   }
      //   console.log(toolCall.args);
    }
  }
  console.log("\n\n✅ 流式输出完成");
} catch (error) {
  console.error("\n❌ 错误:", error.message);
  console.error(error);
}

// 完全不知道干了个啥，没有流失展示的

// 理想状态
// 可以看到，就算是流式返回的 tool_call_chunks 还不完整，也会拼成正确格式的 tool_calls

// 这就是 Output Parser 的价值——模型在流式输出 JSON 字符串的过程中，
// parser 实时尝试解析当前已有的部分，每次 yield 出一个不完整但合法的对象，
// 而不是等全部输出完再一次性解析。用户能看到数据逐步填入，体验更好。

//============================
// 这样你可以实时调用工具，传入部分参数了。
//====================================

// { name: '艾 ' }
// { name: '艾萨克·牛 ' }
// { name: '艾萨克·牛顿' }
// { name: '艾萨克·牛顿', birth_year: 164 }      ← birth_year 还没输完
// { name: '艾萨克·牛顿', birth_year: 1643 }
// { name: '艾萨克·牛顿', birth_year: 1643, death_year: 172 }  ← death_year 还没输完
// { name: '艾萨克·牛顿', birth_year: 1643, death_year: 1727 }

//----------------------------------
//记住这个就行了

// 此外，我们前面说 withStructuredOutput 不适合的场景有两个：

// 流式打印内容，这种还是需要 Output Parser
// XML、YAML 等非 json 格式，也需要 Output Parser
