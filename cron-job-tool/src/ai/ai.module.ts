import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { tool } from '@langchain/core/tools';
import { UserService } from './user.service';
import { z } from 'zod';
import { MailerService } from '@nestjs-modules/mailer';
import { UsersModule } from '../users/users.module';
@Module({
  imports: [UsersModule],
  controllers: [AiController],
  providers: [
    AiService,
    UserService,
    {
      provide: 'CHAT_MODEL',
      useFactory: (configService: ConfigService) => {
        return new ChatOpenAI({
          model: configService.get('MODEL_NAME'),
          apiKey: configService.get('OPENAI_API_KEY'),
          configuration: {
            baseURL: configService.get('OPENAI_BASE_URL'),
          },
        });
      },
      inject: [ConfigService],
    },
    // 使用了注入的形式 来做的tool的注入，
    // 目的主要是：打通 在tool里使用service
    {
      provide: 'QUERY_USER_TOOL',
      useFactory: (userService: UserService) => {
        const queryUserArgsSchema = z.object({
          userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
        });

        return tool(
          async ({ userId }: { userId: string }) => {
            const user = userService.findOne(userId);

            if (!user) {
              const availableIds = userService
                .findAll()
                .map((u) => u.id)
                .join(', ');

              return `用户 ID ${userId} 不存在。可用的 ID: ${availableIds}`;
            }

            return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`;
          },
          {
            name: 'query_user',
            description:
              '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
            schema: queryUserArgsSchema,
          },
        );
      },
      inject: [UserService],
    },
    // 通知邮箱封装成一个tool
    {
      provide: 'SEND_MAIL_TOOL',
      useFactory: (
        mailService: MailerService,
        configService: ConfigService,
      ) => {
        const sendMailArgsSchema = z.object({
          to: z.email().describe('收件人邮箱地址,例如：someone@example.com'),
          subject: z.string().describe('邮件主题'),
          text: z.string().optional().describe('纯文本内容，可选'),
          html: z.string().optional().describe('HTML 内容，可选'),
        });

        return tool(
          async ({
            to,
            subject,
            text,
            html,
          }: {
            to: string;
            subject: string;
            text?: string;
            html?: string;
          }) => {
            const fallbackFrom = configService.get<string>('MAIL_FROM');
            await mailService.sendMail({
              to,
              subject,
              text: text ?? ' (无文本内容)',
              html: html || `<p>${text ? text : '（无 HTML 内容）'}</p>`,
              from: fallbackFrom,
            });
            return `邮件已发送至 ${to}，主题为 "${subject}"。`;
          },
          {
            name: 'send_mail',
            description:
              '发送电子邮件。需提供收件人邮箱、主题和可选文本内容和 HTML 内容。',
            schema: sendMailArgsSchema,
          },
        );
      },
      inject: [MailerService, ConfigService],
    },
    // 跟deepseek相同的搜索方，添加搜索工具
    {
      provide: 'WEB_SEARCH_TOOL',
      useFactory: (configService: ConfigService) => {
        // Implementation for web search tool
        const webSearchArgsSchema = z.object({
          query: z
            .string()
            .min(1)
            .describe('搜索关键词，例如：公司年报、某个事件等'),
          count: z
            .number()
            .min(1)
            .max(20)
            .optional()
            .describe('返回结果数量，默认10条'),
        });

        return tool(
          async ({ query, count }: { query: string; count?: number }) => {
            // Here you would implement the actual web search logic
            const apiKey = configService.get<string>('BOCHA_API_KEY');
            if (!apiKey) {
              return 'Bocha web Search 的 API Key 未配置(环境变量BOCHA_API_KEY)，请在服务端配置后在重试';
            }

            const url =
              configService.get<string>('BOCHA_WEB_SEARCH_URL') ??
              'https://api.bochaai.com/v1/web-search';

            const body = {
              query,
              freshness: 'noLimit',
              summary: true,
              count: count ?? 10,
            };

            let response: Response;
            try {
              response = await fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
              });
            } catch (error) {
              return `搜索 API 连接失败，请检查 BOCHA_WEB_SEARCH_URL、网络代理和服务端出网配置。当前地址：${url}，错误信息：${
                (error as Error).message
              }`;
            }

            if (!response.ok) {
              const errorText = await response.text();
              return `搜索 API 请求失败，状态码：${response.status}，错误信息 ：${errorText}`;
            }

            let json: any;
            try {
              json = await response.json();
            } catch (e) {
              return `搜索 API 请求失败，原因是，搜索结果解析失败 ：${(e as Error).message}`;
            }

            try {
              if (json.code !== 200 || !json.data) {
                return `搜索 API 请求失败，原因是 :${json.msg || '未知错误'}`;
              }

              const webpages = json.data.webPages?.value ?? [];

              if (!webpages.length) {
                return `未找到相关结果`;
              }
              const formatted = webpages
                .map(
                  (page: any, idx: number) =>
                    `引用： ${idx + 1} 
                  标题： ${page.name} 
                  URL: ${page.url} 
                  摘要： ${page.summary} 
                  网站名称： ${page.siteName} 
                  网站图标： ${page.siteIcon} 
                  发布时间： ${page.dateLastCrawled}`,
                )
                .join(' \n\n');
              return formatted;
            } catch (error) {
              return `搜索 API 请求失败，原因是，搜索结果解析失败 ：${(error as Error).message}`;
            }
          },
          {
            name: 'web_search',
            description:
              '使用 Bocha Web Search 搜索互联网上信息。输入为搜索关键词（可选 count指定结果数量），返回包含标题、URL、摘要、网站名称、网站图标和发布时间的搜索结果列表。',
            schema: webSearchArgsSchema,
          },
        );
      },
      inject: [ConfigService],
    },
    // 加入增删改查用户的 tool
    // {
    //   provide: 'DS_USERS_USER_TOOL',
    // },
  ],
})
export class AiModule {}
