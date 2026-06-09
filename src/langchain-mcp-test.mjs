// 上一步是在cursor中chat里调用的mcp

// 这一步 我们在 langchain 代码里调用下 mcp server：

// mcp 本质上还是 tool，和之前的 tool 的区别只不过是可以跨进程调用

// 跨进程就意味着不限语言，开发好之后，可以被任意 mcp client 调用，比如 cursor、langchain 等。

// 当你不需要跨进程用的时候，还是之前那样写更好，还少了进程通信的成本。
import "dotenv/config";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import chalk from "chalk";
import {
  HumanMessage,
  ToolMessage,
  SystemMessage,
} from "@langchain/core/messages";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    "my-mcp-server": {
      command: "node",
      args: ["/Users/15734/Desktop/wx-agent/tool-test/src/my-mcp-server.mjs"],
    },
  },
});

const tools = await mcpClient.getTools();

// 指南的用法
const res = await mcpClient.listResources();

let resourceContent = "";
for (const [serverName, resources] of Object.entries(res)) {
  for (const resource of resources) {
    const content = await mcpClient.readResource(serverName, resource.uri);
    // 我能指向获取到text，并把它插入到system Prompt中, 也可以用在 human message 里，总之，是作为信息引用的。
    resourceContent += content[0].text;
  }
}

const modelWithTools = model.bindTools(tools);

// 这就是一个简单的agent
async function runAgentWithTools(query, maxIterations = 30) {
  const messages = [
    // 新增的
    new SystemMessage(resourceContent),
    new HumanMessage(query),
  ];

  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考...`));
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${response.content}\n`);
      return response.content;
    }
    console.log(
      chalk.bgBlue(`🔍 检测到 ${response.tool_calls.length} 个工具调用`),
    );

    console.log(
      chalk.bgBlue(
        `🔍 工具调用: ${response.tool_calls.map((t) => t.name).join(", ")}`,
      ),
    );

    // 执行工具调用
    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find((t) => t.name === toolCall.name);
      if (foundTool) {
        const toolResult = await foundTool.invoke(toolCall.args);
        messages.push(
          new ToolMessage({
            content: toolResult,
            tool_call_id: toolCall.id,
          }),
        );
      }
    }
  }

  return messages[messages.length - 1].content;
}

// await runAgentWithTools("查一下用户 002 的信息");

await runAgentWithTools("MCP Server 的使用指南是什么");

// -------------------看看resource的用法--------------------
// const res = await mcpClient.listResources();

// console.log(res);

// {
//   'my-mcp-server': [
//     {
//       uri: 'docs://guide',
//       name: '使用指南',
//       description: 'MCP Server 使用文档',
//       mimeType: 'text/plain'
//     }
//   ]
// }

//======================================================
// for (const [serverName, resources] of Object.entries(res)) {
//   for (const resource of resources) {
//     const content = await mcpClient.readResource(serverName, resource.uri);
//     console.log(content);
//   }
// }

// {
//   'my-mcp-server': [
//     {
//       uri: 'docs://guide',
//       name: '使用指南',
//       description: 'MCP Server 使用文档',
//       mimeType: 'text/plain'
//     }
//   ]
// }
// [
//   {
//     uri: 'docs://guide',
//     mimeType: 'text/plain',
//     text: 'MCP Server 使用指南\n' +
//       '            功能：提供用户查询等工具。\n' +
//       '            使用：在 Cursor 等 MCP Client 中通过自然语言对话，Cursor 会自动调用相应工具。\n' +
//       '         ',
//     blob: undefined
//   }
// ]

// 避免控制台子进程没退出的问题
await mcpClient.close();
