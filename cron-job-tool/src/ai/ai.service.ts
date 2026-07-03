import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { z } from 'zod';
import { Runnable } from '@langchain/core/runnables';

// 使用了外部注入的tool后这部分就不需要了

// const database = {
//   users: {
//     '001': {
//       id: '001',
//       name: '张三',
//       email: 'zhangsan@example.com',
//       role: 'admin',
//     },
//     '002': { id: '002', name: '李四', email: 'lisi@example.com', role: 'user' },
//     '003': {
//       id: '003',
//       name: '王五',
//       email: 'wangwu@example.com',
//       role: 'user',
//     },
//   },
// };

// const queryUserArgsSchema = z.object({
//   userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
// });

// type QueryUserArgs = {
//   userId: string;
// };

// const queryUserTool = tool(
//   async ({ userId }: QueryUserArgs) => {
//     const user = database.users[userId];

//     if (!user) {
//       return `用户 ID ${userId} 不存在。可用的 ID: 001, 002, 003`;
//     }

//     return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`;
//   },
//   {
//     name: 'query_user',
//     description:
//       '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
//     schema: queryUserArgsSchema,
//   },
// );

@Injectable()
export class AiService {
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  constructor(
    @Inject('CHAT_MODEL') model: ChatOpenAI,
    @Inject('QUERY_USER_TOOL') private readonly queryUserTool: any,
    @Inject('SEND_MAIL_TOOL') private readonly sendMailTool: any,
    @Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: any,
    @Inject('DB_USERS_CRUD_TOOL') private readonly dbUsersCrudTool: any,
    @Inject('CRON_JOB_TOOL') private readonly cronJobTool: any,
  ) {
    this.modelWithTools = model.bindTools([
      this.queryUserTool,
      this.sendMailTool,
      this.webSearchTool,
      this.dbUsersCrudTool,
      this.cronJobTool,
    ]);
  }

  async runChain(query: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一个智能助手。可以再需要时调用工具，（如query_user）来查询用户信息，再用结果回答用户问题。',
      ),
      new HumanMessage(query),
    ];

    while (true) {
      const aiMessage = await this.modelWithTools.invoke(messages);
      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls ?? [];

      // 没有要调用的工具，直接把回答返回给调用方
      if (!toolCalls.length) {
        return aiMessage.content as string;
      }

      // 依次执行本轮需要调用的所有工具
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const result = await this.queryUserTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'send_mail') {
          const result = await this.sendMailTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'web_search') {
          const result = await this.webSearchTool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'db_users_crud') {
          const result = await this.dbUsersCrudTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'cron_job') {
          const result = await this.cronJobTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        }
      }
    }
  }

  async *runChainStream(query: string): AsyncIterable<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        '你是一个智能助手。可以再需要时调用工具，（如query_user）来查询用户信息，再用结果回答用户问题。',
      ),
      new HumanMessage(query),
    ];

    while (true) {
      // 一轮对话：先让模型思考并（可能）提出工具调用
      const stream = await this.modelWithTools.stream(messages);

      let fullAIMessage: AIMessageChunk | null = null;

      for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
        // 使用 concat 持续拼接，得到本轮完整的 AIMessageChunk
        fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

        const hasToolCallChunk =
          !!fullAIMessage.tool_call_chunks &&
          fullAIMessage.tool_call_chunks.length > 0;

        // 只要当前轮次还没出现 tool 调用的 chunk，就可以把文本内容流式往外推
        if (!hasToolCallChunk && chunk.content) {
          yield chunk.content as string;
        }
        // console.log('===', fullAIMessage);
      }
      // ===
      // ===
      // ===
      // ===
      // ===
      // === 用户
      // ===
      // === 001
      // ===  的
      // === 信息
      // === ：

      // === -
      // ===  姓
      // === 名
      // === ：
      // === 张
      // === 三
      // ===

      // === -
      // ===  邮
      // === 箱
      // === ：
      // === zh
      // === ang
      // === san
      // === @example
      // === .com
      // ===

      // === -
      // ===
      // === 角色
      // === ：admin
      // ===
      // ===

      // 反复横跳 第一次没tool
      // === AIMessageChunk {
      //     "id": "resp_0ab52b4cff37e167016a437f9e78d4819183e6e5e58a99efac",
      //     "content": "用户 001 的信息：\n- 姓名",
      //     "additional_kwargs": {},
      //     "response_metadata": {
      //         "prompt": 0,
      //         "completion": 0,
      //         "model_provider": "openai",
      //         "usage": {}
      //     },
      //     "tool_calls": [],
      //     "tool_call_chunks": [],
      //     "invalid_tool_calls": []
      // }

      // 反复横跳 第二次有tool

      // === AIMessageChunk {
      //         "id": "resp_06aa7fd563e4eb7c016a437ef6d43c8198be0aba772e46af0e",
      //         "content": "",
      //         "tool_calls": [
      //             {
      //             "name": "query_user",
      //             "args": {},
      //             "id": "call_xFUOD4jccv2f2ihp3VW1sBt9",
      //             "type": "tool_call"
      //             }
      //         ],
      //         "tool_call_chunks": [
      //             {
      //             "name": "query_user",
      //              "args": "{\"userId\":\"001\"}",
      //             "id": "call_xFUOD4jccv2f2ihp3VW1sBt9",
      //             "index": 0,
      //             "type": "tool_call_chunk"
      //             }
      //         ],
      //         "invalid_tool_calls": []
      //         }
      //   }

      // 反复横跳 第三次无tool，直接输出输出完整的tool调用结果了，逐渐拼接的流失，chunk.content

      // === AIMessageChunk {
      //   "id": "resp_0cfa73971e309960016a43800ff520819194d17b45443c5c0e",
      //   "content": "用户 001 的信息：\n- 姓名：张三\n- 邮箱：zhangsan@example.com\n- 角色：admin",
      //   "additional_kwargs": {},
      //   "response_metadata": {
      //     "prompt": 0,
      //     "completion": 0,
      //     "model_provider": "openai",
      //     "usage": {
      //       "prompt_tokens": 171,
      //       "completion_tokens": 32,
      //       "total_tokens": 203
      //     },
      //     "finish_reason": "stop",
      //     "model_name": "gpt-5.4"
      //   },
      //   "tool_calls": [],
      //   "tool_call_chunks": [],
      //   "invalid_tool_calls": [],
      //   "usage_metadata": {
      //     "input_tokens": 171,
      //     "output_tokens": 32,
      //     "total_tokens": 203,
      //     "input_token_details": {},
      //     "output_token_details": {}
      //   }
      // }

      if (!fullAIMessage) {
        return;
      }
      messages.push(fullAIMessage);

      const toolCalls = fullAIMessage.tool_calls ?? [];

      // 没有工具调用：说明这一轮就是最终回答，已经在上面的 for-await 中流完了，可以结束
      if (!toolCalls.length) {
        return;
      }

      //   有工具调用：本轮我们不再额外输出内容，而是执行工具，生成 ToolMessage，进入下一轮
      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const result = await this.queryUserTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'send_mail') {
          const result = await this.sendMailTool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'web_search') {
          const result = await this.webSearchTool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'db_users_crud') {
          const result = await this.dbUsersCrudTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'cron_job') {
          const result = await this.cronJobTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        }
      }
    }
  }
}
