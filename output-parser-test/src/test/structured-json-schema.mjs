import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import chalk from "chalk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const scientistSchema = z
  .object({
    name: z.string().describe("科学家的全名"),
    birth_year: z.number().describe("出生年份"),
    field: z.string().describe("主要研究领域"),
    achievements: z.array(z.string()).describe("主要成就列表"),
  })
  .strict();

// 将 Zod 转换为原生的 JSON Schema 格式，使用 openApi3 目标去掉多余字段
const nativeJsonSchema = zodToJsonSchema(scientistSchema);

const model = new ChatOpenAI({
  modelName: "qwen3.7-plus",
  apiKey: process.env.OPENAI_API_EMBDDING_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_EMBDDING__URL,
  },
  modelKwargs: {
    // 通过 modelKwargs 传入原生参数
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scientist_info",
        strict: true,
        schema: nativeJsonSchema, // 这里的 nativeJsonSchema 就是转换后的对象
      },
    },
  },
});

async function testNativeJsonSchema() {
  console.log(chalk.bgMagenta("🧪 测试原生 JSON Schema 模式...\n"));

  const res = await model.invoke([
    new SystemMessage("你是一个信息提取助手，请直接返回标准的 JSON 对象数据"),
    new HumanMessage("介绍一下杨振宁"),
  ]);

  console.log(chalk.green("\n✅ 收到响应 (纯净 JSON):"));
  console.log(res.content);

  const data = JSON.parse(res.content);
  console.log(chalk.cyan("\n📋 解析后的对象:"));
  console.log(data);
}

testNativeJsonSchema().catch(console.error);

// 当然，平时开发用 withStructuredOutput 就可以了，这个 api 会根据模型自动选择对应的实现。

// {
//   "name": "杨振宁",
//   "english_name": "Chen-Ning Franklin Yang",
//   "birth_date": "1922年10月1日",
//   "birth_place": "安徽省合肥市",
//   "nationality": "中国",
//   "occupation": "理论物理学家",
//   "education": [
//     "国立西南联合大学 学士、硕士",
//     "美国芝加哥大学 博士"
//   ],
//   "major_achievements": [
//     "与李政道共同提出弱相互作用中宇称不守恒原理",
//     "提出杨-米尔斯规范场论（Yang-Mills theory）",
//     "提出杨-巴克斯特方程（Yang-Baxter equation）"
//   ],
//   "awards": [
//     "1957年诺贝尔物理学奖",
//     "1980年拉姆福德奖",
//     "1986年美国国家科学奖章",
//     "2019年求是终身成就奖"
//   ],
//   "family": {
//     "father": "杨武之",
//     "spouses": [
//       "杜致礼（1950年-2003年）",
//       "翁帆（2004年-至今）"
//     ]
//   }
// }

// 📋 解析后的对象:
// {
//   name: '杨振宁',
//   english_name: 'Chen-Ning Franklin Yang',
//   birth_date: '1922年10月1日',
//   birth_place: '安徽省合肥市',
//   nationality: '中国',
//   occupation: '理论物理学家',
//   education: [ '国立西南联合大学 学士、硕士', '美国芝加哥大学 博士' ],
//   major_achievements: [
//     '与李政道共同提出弱相互作用中宇称不守恒原理',
//     '提出杨-米尔斯规范场论（Yang-Mills theory）',
//     '提出杨-巴克斯特方程（Yang-Baxter equation）'
//   ],
//   awards: [ '1957年诺贝尔物理学奖', '1980年拉姆福德奖', '1986年美国国家科学奖章', '2019年求是终身成就奖' ],
//   family: { father: '杨武之', spouses: [ '杜致礼（1950年-2003年）', '翁帆（2004年-至今）' ] }
// }
