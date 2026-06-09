import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 数据库
const database = {
  users: {
    "001": {
      id: "001",
      name: "张三",
      email: "zhangsan@example.com",
      role: "admin",
    },
    "002": { id: "002", name: "李四", email: "lisi@example.com", role: "user" },
    "003": {
      id: "003",
      name: "王五",
      email: "wangwu@example.com",
      role: "user",
    },
  },
};

const server = new McpServer({
  name: "my-mcp-server",
  version: "1.0.0",
});

// 注册工具：查询用户信息

server.registerTool(
  "query_user",
  {
    description:
      "查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。",
    inputSchema: {
      userId: z.string().describe("用户 ID，例如: 001, 002, 003"),
    },
  },
  async ({ userId }) => {
    const user = database.users[userId];

    if (!user) {
      return {
        content: [
          {
            type: "text",
            text: `用户 ID ${userId} 不存在。可用的 ID: 001, 002, 003`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`,
        },
      ],
    };
  },
);

// resource 主要是查询信息用的（read） 而 tool ⬆️ 是执行功能用的（call）
server.registerResource(
  "使用指南",
  "docs://guide",
  {
    description: "MCP Server 使用文档",
    mimeType: "text/plain",
  },
  async () => {
    return {
      contents: [
        {
          uri: "docs://guide",
          mimeType: "text/plain",
          text: `MCP Server 使用指南
            功能：提供用户查询等工具。
            使用：在 Cursor 等 MCP Client 中通过自然语言对话，Cursor 会自动调用相应工具。
         `,
        },
      ],
    };
  },
);

// 创建一个 stdio 传输层实例。 是 MCP SDK 内置的一种传输方式，它的工作原理：和你在 node-exec.mjs 里看到的 spawn + stdio: "inherit" 是一回事
// 通过标准输入输出做进程间通信，只不过 MCP SDK 把它封装了一层，自动处理 JSON-RPC 格式的序列化/反序列化。
// 本地 MCP Client（最常用）
const transport = new StdioServerTransport();
// 把 McpServer 实例绑定到这个传输层上，开始接受请求。
// 服务器，开始监听 stdin 上的消息，处理完后通过 stdout 回复
server.connect(transport);

// 在 cursor上创建的mcp.json
//  "my-mcp-server": {
//       "command": "node",
//       "args": ["/Users/15734/Desktop/wx-agent/tool-test/src/my-mcp-server.mjs"]
//     }
