// 那如果我们就是想用 tool calls 来做结构化输出，但还是想要流式的打印，怎么办呢？
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

console.log("🌊 流式 Tool Calls 演示 - 直接打印原始 tool_calls_chunk\n");

try {
  // 开启流式输出
  const stream = await modelWithTool.stream("详细介绍牛顿的生平和成就");

  console.log("📡 实时输出流式 tool_calls_chunk:\n");

  let chunkIndex = 0;

  // 注意这里打印的是 tool_call_chunks 不是 tool_calls, 这是modelWithTool.stream，不是invoke

  for await (const chunk of stream) {
    chunkIndex++; // 直接打印每个 chunk 的 tool_calls 信息
    if (chunk.tool_call_chunks && chunk.tool_call_chunks.length > 0) {
      process.stdout.write(chunk.tool_call_chunks[0].args);
    }
  }
  console.log("\n\n✅ 流式输出完成");
} catch (error) {
  console.error("\n❌ 错误:", error.message);
  console.error(error);
}

// 是流式 输出

// 🌊 流式 Tool Calls 演示 - 直接打印原始 tool_calls_chunk

// 📡 实时输出流式 tool_calls_chunk:

// {"achievements":["提出运动三定律，奠定经典力学基础","提出万有引力定律，统一解释天体与地面物体的运动","与莱布尼茨分别独立发展微积分的重要方法","在光学研究中证明白光可分解为不同颜色，并系统研究色散现象","发明实用的反射式望远镜，推动天文观测仪器改进","著有《自然哲学的数学原理》和《光学》，深刻影响近代科学发展"],"biography":"艾萨克·牛顿是英国最伟大的科学家之一，出生于英格兰林肯郡伍尔索普。少年时期曾在格兰瑟姆求学，后进入剑桥大学三一学院。1665年至1666年因伦敦鼠疫流行返乡，在此期间完成了关于微积分、光学和引力的关键思想，常被称为他的“奇迹年”。此后他回到剑桥任教，担任卢卡斯数学教授。1687年发表《自然哲学的数学原理》，建立了经典力学体系。晚年他担任英国皇家铸币厂监理和厂长，并长期活跃于英国皇家学会，1703年起任会长。牛顿不仅是数学家、物理学家和天文学家，也深受炼金术、神学和自然哲学问题吸引。1727年在伦敦逝世，安葬于威斯敏斯特教堂。","birth_year":1643,"death_year":1727,"fields":["物理学","数学","天文学","光学","自然哲学"],
// "name":"艾萨克·牛顿","nationality":"英国"}

// ✅ 流式输出完成,

// 注意 args 的结构，这个是能流式打印的啊

// "tool_calls": [],
// "tool_call_chunks": [{
// "args":"\"],\"biography\":\""",
//   id:"",
//   index":0,
//   type: "tool_call_chunk"
// }

//===================================
// 这种是不可以的，需要用另外的方法
// 这时候是不能调用 tool 的，因为参数还不完整，没有 tool_calls 信息。
// 这种就可以用 JsonOutputToolsParser 了
// "tool_calls": [],
// "tool_call_chunks":[
//     {
//         "args":"因瘟疫停"，
//         id：""，
//         "index":0,
//         "type":"tool_call_chunk"
//     }]
