import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 错误 格式化过滤错误
  app.useGlobalFilters(new AllExceptionsFilter());
  // 正常格式化输出
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.listen(process.env.PORT ?? 3000);
  console.log(`应用已启动: http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
