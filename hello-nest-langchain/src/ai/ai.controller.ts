import { Controller, Get, Query, Sse } from '@nestjs/common';
import { AiService } from './ai.service';
import { from, map, Observable } from 'rxjs';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('chat')
  async chat(@Query('query') query: string) {
    const answer = await this.aiService.runChain(query);
    return { answer };
  }
  @Sse('chat/stream')
  chatStream(@Query('query') query: string): Observable<{ data: string }> {
    const stream = this.aiService.streamChain(query);
    // 这个是 rxjs 的写法，Nest 用 rxjs 来处理异步流。
    // from — 是把"别的东西"变成 Observable
    // 返回值写 Observable 意思是：我不直接给你结果，我给你一个"物流单号"，你订阅它就能持续收到包裹
    // from 是格式转换器，Observable 是包装箱，合起来就是为了让 NestJS 的 @Sse() 能持续往前端推数据。
    return from(stream).pipe(map((chunk) => ({ data: chunk })));
  }
}
