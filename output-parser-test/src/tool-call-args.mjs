import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
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
  nationality: z.string().describe("国籍"),
  fields: z.array(z.string()).describe("研究领域列表"),
});

//这里没定义 tool 的实现逻辑，因为我们只是告诉大模型有这个 tool、参数是什么格式，不需要执行

// 大模型只是返回 tool call 的参数，具体调用是 agent 来调
const modelWithTool = model.bindTools([
  {
    name: "extract_scientist_info",
    description: "提取和结构化科学家的详细信息",
    schema: scientistSchema,
  },
]);

// 调用模型
const response = await modelWithTool.invoke("介绍一下爱因斯坦");

console.log("response.tool_calls:", response.tool_calls);

// response.tool_calls: [
//   {
//     name: 'extract_scientist_info',
//     args: {
//       birth_year: 1879,
//       fields: [Array],
//       name: 'Albert Einstein',
//       nationality: 'German-born theoretical physicist (later Swiss and American citizen)'
//     },
//     type: 'tool_call',
//     id: 'call_dPCMCHuEG8j0zB0xPloEOd1I'
//   }
// ]

// 而且，这种方式比 output parser 更好。
// 因为模型训练的时候就保证了生成 tool calls 的参数一定是符合格式要求的，如果不符合，会重新生成。

// 那岂不是没必要用 output parser 了？
// 确实，如果只是要求结构化返回数据，用 tool 就行了。

// 所以，现在获取结构化数据一般会用 withStructuredOutput 这个 api它会判断模型是否支持 tool calls，
// 支持的话就用 tool 的方式获取结构化数据，否则用 output parser 的方式，不用我们自己去处理。

// 获取结构化结果
const result = response.tool_calls[0].args;

console.log("结构化结果:", JSON.stringify(result, null, 2));
console.log(`\n姓名: ${result.name}`);
console.log(`出生年份: ${result.birth_year}`);
console.log(`国籍: ${result.nationality}`);
console.log(`研究领域: ${result.fields.join(", ")}`);
