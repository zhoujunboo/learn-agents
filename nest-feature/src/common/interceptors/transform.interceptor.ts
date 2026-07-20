import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map, tap } from 'rxjs';
import { ApiResponse } from '../interfaces/api-response.interface';
// 在main中使用的
// 对相应的格式进行转换 code  data  message
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
    }>();
    const { method, url } = request;
    const startTime = Date.now();
    const requestTime = new Date().toISOString();

    console.log(`[请求] ${requestTime} ${method} ${url}`);

    return next.handle().pipe(
      map((data) => ({
        code: 200,
        data,
        message: '成功',
      })),
      tap(() => {
        const duration = Date.now() - startTime;
        console.log(
          `[响应] ${new Date().toISOString()} ${method} ${url} 耗时 ${duration}ms`,
        );
      }),
    );
  }
}
