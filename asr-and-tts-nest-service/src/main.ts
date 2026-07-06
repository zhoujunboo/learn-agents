import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WebSocketServer } from 'ws';
import { TtsRelayService } from './speech/tts-relay.service';

/**
 * 应用启动入口
 * 创建 NestJS 应用，并在 HTTP 服务上挂载 TTS WebSocket 端点
 */
async function bootstrap() {
  // 创建 NestJS 应用实例
  const app = await NestFactory.create(AppModule);

  // 获取 TTS 中继服务实例（处理腾讯云 TTS 的 WebSocket 连接和音频转发）
  const ttsRelayService = app.get(TtsRelayService);

  // 在现有 HTTP 服务器上附加 WebSocket 服务
  const server = app.getHttpServer();
  const ttsWss = new WebSocketServer({
    server,
    path: '/speech/tts/ws', // WebSocket 路径：前端通过 ws://host/speech/tts/ws 连接
  });

  // 处理前端 WebSocket 连接请求
  ttsWss.on('connection', (socket, request) => {
    // 从 URL 查询参数中读取客户端指定的 sessionId（可选）
    const reqUrl = new URL(request.url ?? '', 'http://localhost');
    const wantedSessionId = reqUrl.searchParams.get('sessionId') ?? undefined;
    // 注册客户端连接，获得会话 ID
    const sessionId = ttsRelayService.registerClient(socket, wantedSessionId);

    // 客户端断开连接时，清理会话
    socket.on('close', () => {
      ttsRelayService.unregisterClient(sessionId);
    });
  });

  // 启动 HTTP 服务，默认端口 3000
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
