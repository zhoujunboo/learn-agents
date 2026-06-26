import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
// import { ConfigService } from '@nestjs/config';
@Injectable()
export class AiService {
  private readonly chain: Runnable<{ query: string }, string>;

  // ConfigService这里只能用构造器注入，这时候还没创建对象，没法用属性注入
  // constructor(@Inject(ConfigService) configService: ConfigService) {
  constructor(@Inject('CHAT_MODEL') model: ChatOpenAI) {
    const prompt = PromptTemplate.fromTemplate('请回答以下问题：\n\n{query}');

    // // 在构造器里创建 ChatModel、chain 避免重复创建。
    // const model = new ChatOpenAI({
    //   modelName: configService.get('MODEL_NAME'),
    //   apiKey: configService.get('OPENAI_API_KEY'),
    //   temperature: 0.7,
    //   configuration: {
    //     baseURL: configService.get('OPENAI_BASE_URL'),
    //   },
    // });
    this.chain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  async runChain(query: string): Promise<string> {
    return this.chain.invoke({ query });
  }

  //这里用到了 js 的生成器语法，也就是方法名那里标个*，然后 yield 不断异步返回内容
  async *streamChain(query: string): AsyncGenerator<string> {
    const stream = await this.chain.stream({ query });
    for await (const chunk of stream) {
      yield chunk;
    }
  }
}
