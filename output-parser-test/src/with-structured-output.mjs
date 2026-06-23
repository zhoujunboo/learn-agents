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

//
//  withStructuredOutput 默认用 tool_choice: "any" 模式，但你的 API 服务不支持，要求必须指定 tool_choice.name。
// 使用 withStructuredOutput 方法，指定 name 以兼容部分 API 所以加上了 name: "extract_scientist_info"
const structuredModel = model.withStructuredOutput(scientistSchema, {
  name: "extract_scientist_info",
});

// 调用模型
const result = await structuredModel.invoke("介绍一下爱因斯坦");

console.log("结构化结果:", JSON.stringify(result, null, 2));
console.log(`\n姓名: ${result.name}`);
console.log(`出生年份: ${result.birth_year}`);
console.log(`国籍: ${result.nationality}`);
console.log(`研究领域: ${result.fields.join(", ")}`);
