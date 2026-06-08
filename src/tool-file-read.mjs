import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import fs from "node:fs/promises";
import { z } from "zod";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const readFileTool = tool(
  async ({ filePath }) => {
    const content = await fs.readFile(filePath, "utf-8");
    console.log(
      `  [工具调用] read_file("${filePath}") - 成功读取 ${content.length} 字节`,
    );
    return `文件内容:\n${content}`;
  },
  {
    name: "read_file",
    description:
      "用此工具来读取文件内容。当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。",
    schema: z.object({
      filePath: z.string().describe("要读取的文件路径"),
    }),
  },
);

const tools = [readFileTool];

// console.log(tools, "======看看tool打印的是啥");
// [
//   DynamicStructuredTool {
//     name: 'read_file',
//     verbose: false,
//     callbacks: undefined,
//     tags: [],
//     metadata: { versions: [Object] },
//     description: '用此工具来读取文件内容。当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。',
//     func: [AsyncFunction: func],

const modelWithTools = model.bindTools(tools);

const messages = [
  new SystemMessage(`你是一个代码助手，可以使用工具读取文件并解释代码。
    工作流程：
    1. 用户要求读取文件时，立即调用 read_file 工具
    2. 等待工具返回文件内容
    3. 基于文件内容进行分析和解释

    可用工具：
    - read_file: 读取文件内容（使用此工具来获取文件内容）
    `),
  new HumanMessage(`请读取 src/tool-file-read.mjs 文件内容并解释代码`),
];

let response = await modelWithTools.invoke(messages);

// console.log(response); //第一部分打印输出结束

// AIMessage {
//   "id": "chatcmpl-10c942e0-a035-40d0-a70d-5e162",
//   "content": "",
//   "additional_kwargs": {
//     "tool_calls": [
//       {
//         "function": "[Object]",
//         "id": "call_bFD7Rqh2s9YYr4WsjcyVgWwn",
//         "index": 0,
//         "type": "function"
//       }
//     ]
//   },
//   "response_metadata": {
//     "tokenUsage": {
//       "promptTokens": 183,
//       "completionTokens": 24,
//       "totalTokens": 207
//     },
//     "finish_reason": "tool_calls",
//     "model_provider": "openai",
//     "model_name": "gpt-5.4-mini"
//   },
//   "tool_calls": [
//     {
//       "name": "read_file",
//       "args": {
//         "filePath": "src/tool-file-read.mjs"
//       },
//       "type": "tool_call",
//       "id": "call_bFD7Rqh2s9YYr4WsjcyVgWwn"
//     }
//   ],
//   "invalid_tool_calls": [],
//   "usage_metadata": {
//     "output_tokens": 24,
//     "input_tokens": 183,
//     "total_tokens": 207,
//     "input_token_details": {},
//     "output_token_details": {}
//   }
// }

// 把 ai 返回的消息也放入message数组， 也就是对话记录（个人理解 组装messages-AIMessage  ）
messages.push(response);

while (response.tool_calls && response.tool_calls.length > 0) {
  console.log(`\n[检测到 ${response.tool_calls.length} 个工具调用]`);

  //执行所有的工具调用
  const toolResults = await Promise.all(
    response.tool_calls.map(async (toolCall) => {
      const tool = tools.find((t) => t.name === toolCall.name);
      if (!tool) {
        return `错误: 找不到工具 ${toolCall.name}`;
      }

      console.log(
        `  [执行工具] ${toolCall.name}(${JSON.stringify(toolCall.args)})`,
      );
      try {
        // 注意这个 - 在我们自己定义的tools中匹配到后-取出的方法
        // 因为是DynamicStructuredTool 继承Runnable基类  所以我理解有invoke方法,在 LangChain 中，一切皆 Runnable
        // Runnable 定义了统一的执行接口  invoke(input) — 单次调用 batch(inputs) — 批量调用 stream(input) — 流式调用 pipe() — 链式组合
        const result = await tool.invoke(toolCall.args);
        return result;
      } catch (error) {
        return `错误: ${error.message}`;
      }
    }),
  );
  // console.log(toolResults, "=====看看调用结果是啥=result====");
  // [
  // '文件内容:\n' +
  //   'import "dotenv/config";\r\n' +

  // 将工具执行结果 ，添加到消息历史messages （个人理解 组装messages-ToolMessage）
  response.tool_calls.forEach((toolCall, index) => {
    messages.push(
      new ToolMessage({
        content: toolResults[index],
        tool_call_id: toolCall.id,
      }),
    );
  });

  // 再次 调用模型，传入工具结果
  response = await modelWithTools.invoke(messages);
}

console.log("\n[最终回复]");
console.log(response.content);

// ...

// # 一句话总结

// 这段代码实现了一个基于 LangChain 的“**文件读取 + 大模型解释**”助手：模型先调用 `read_file` 工具读取目标文件，再根据返回内容生成最终分析结果。

// 如果你愿意，我还可以继续帮你：
// 1. **把这段代码改写成更规范的版本**
// 2. **画出它的执行流程图**
// 3. **逐行注释这份文件**

// ...
