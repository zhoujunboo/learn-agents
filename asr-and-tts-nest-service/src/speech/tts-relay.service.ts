import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { OnEvent } from '@nestjs/event-emitter';
import {
  AI_TTS_STREAM_EVENT,
  type AiTtsStreamEvent,
} from '../common/stream-events';
import WebSocket from 'ws';

// ===== 客户端会话类型定义 =====
// sessionId: 会话唯一标识
// clientWs:   与前端页面的 WebSocket 连接
// tencentWs:  与腾讯云 TTS 的 WebSocket 连接
// ready:      腾讯云 TTS 是否就绪（收到 ready=1 后才可发送文本）
// pendingChunks: 在 TTS 就绪前暂存的待合成文本块
// closed:     会话是否已关闭
type ClientSession = {
  sessionId: string;
  clientWs: WebSocket;
  tencentWs?: WebSocket;
  ready: boolean;
  pendingChunks: string[];
  closed: boolean;
};

@Injectable()
export class TtsRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(TtsRelayService.name);
  private readonly sessions = new Map<string, ClientSession>();
  private readonly secretId: string; // 腾讯云 API 密钥 ID
  private readonly secretKey: string; // 腾讯云 API 密钥 Key
  private readonly appId: number; // 腾讯云应用 ID
  private readonly voiceType: number; // TTS 音色编号（默认 101001）

  constructor(@Inject(ConfigService) configService: ConfigService) {
    // 从环境变量读取腾讯云 TTS 配置
    this.secretId = configService.get<string>('SECRET_ID') ?? '';
    this.secretKey = configService.get<string>('SECRET_KEY') ?? '';
    this.appId = Number(configService.get<string>('APP_ID') ?? 0);
    this.voiceType = Number(
      configService.get<string>('TTS_VOICE_TYPE') ?? 101001,
    );
  }

  // 模块销毁时，关闭所有 TTS 会话
  onModuleDestroy(): void {
    for (const session of this.sessions.values()) {
      this.closeSession(session.sessionId, 'module destroy');
    }
  }

  /**
   * 注册客户端连接（前端 WebSocket 连上来时调用）
   * @param clientWs 前端的 WebSocket 实例
   * @param wantedSessionId 可选，指定 sessionId；不传则自动生成 UUID
   * @returns sessionId
   */
  registerClient(clientWs: WebSocket, wantedSessionId?: string): string {
    const sessionId = wantedSessionId?.trim() || randomUUID();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      // 同一 sessionId 重复连接 → 关掉旧的
      this.closeSession(sessionId, 'client reconnected');
    }

    // 创建新会话记录
    this.sessions.set(sessionId, {
      sessionId,
      clientWs,
      ready: false,
      pendingChunks: [],
      closed: false,
    });
    // 通知前端：session 已创建，返回 sessionId
    this.sendClientJson(clientWs, { type: 'session', sessionId });
    this.logger.log(`TTS client connected: ${sessionId}`);
    return sessionId;
  }

  /**
   * 注销客户端连接（前端断开时调用）
   */
  unregisterClient(sessionId: string): void {
    this.closeSession(sessionId, 'client disconnected');
  }

  /**
   * 监听 AI 模块发出的 TTS 流事件（start / chunk / end / error）
   * 将 AI 生成的文本逐块推送给腾讯云 TTS，再把音频转发给前端
   */
  @OnEvent(AI_TTS_STREAM_EVENT)
  handleAiStreamEvent(event: AiTtsStreamEvent): void {
    const session = this.sessions.get(event.sessionId);
    if (!session) return;

    switch (event.type) {
      case 'start': {
        // AI 开始输出 → 建立腾讯云 TTS WebSocket 连接
        this.ensureTencentConnection(session);
        this.sendClientJson(session.clientWs, {
          type: 'tts_started',
          sessionId: session.sessionId,
          query: event.query,
        });
        break;
      }
      case 'chunk': {
        // AI 输出了一段文本 → 发给腾讯云 TTS 合成语音
        const chunk = event.chunk?.trim();
        if (!chunk) return;
        // 如果 TTS 还没就绪，先存到 pendingChunks 队列
        if (
          !session.ready ||
          !session.tencentWs ||
          session.tencentWs.readyState !== WebSocket.OPEN
        ) {
          session.pendingChunks.push(chunk);
          return;
        }
        this.sendTencentChunk(session, chunk);
        break;
      }
      case 'end': {
        // AI 输出完毕 → 先刷完 pendingChunks，再通知腾讯云结束
        this.flushPendingChunks(session);
        if (
          session.tencentWs &&
          session.tencentWs.readyState === WebSocket.OPEN
        ) {
          session.tencentWs.send(
            JSON.stringify({
              session_id: session.sessionId,
              action: 'ACTION_COMPLETE',
            }),
          );
        }
        break;
      }
      case 'error': {
        // AI 报错 → 通知前端并关闭会话
        this.sendClientJson(session.clientWs, {
          type: 'tts_error',
          message: event.error,
        });
        this.closeSession(session.sessionId, 'ai stream error');
        break;
      }
    }
  }

  /**
   * 确保腾讯云 TTS WebSocket 已连接
   * 如果已连接则直接返回；未连接则创建新连接
   */
  private ensureTencentConnection(session: ClientSession): void {
    // 连接已存在且状态正常 → 复用
    if (session.tencentWs && session.tencentWs.readyState <= WebSocket.OPEN) {
      return;
    }
    // 检查凭证是否已配置
    if (!this.secretId || !this.secretKey || !this.appId) {
      this.sendClientJson(session.clientWs, {
        type: 'tts_error',
        message: 'TTS 凭证缺失，请检查 SECRET_ID/SECRET_KEY/APP_ID',
      });
      return;
    }

    // 构建 WebSocket URL 并建立连接
    const url = this.buildTencentTtsWsUrl(session.sessionId);
    const tencentWs = new WebSocket(url);
    session.tencentWs = tencentWs;
    session.ready = false;

    // TTS 连接打开
    tencentWs.on('open', () => {
      this.logger.log(`Tencent TTS ws opened: ${session.sessionId}`);
    });

    // 收到腾讯云的消息：二进制 = 音频数据直接转发给前端；JSON = 状态信息
    tencentWs.on('message', (data, isBinary) => {
      if (session.closed) return;
      if (isBinary) {
        // 二进制数据 → 音频流，直接转发给前端
        if (session.clientWs.readyState === WebSocket.OPEN) {
          session.clientWs.send(data, { binary: true });
        }
        return;
      }

      // JSON 消息 → 解析状态
      const raw = data.toString();
      let msg: Record<string, unknown> | undefined;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

      // ready=1 表示 TTS 已就绪，可以发送文本了
      if (Number(msg.ready) === 1) {
        session.ready = true;
        this.flushPendingChunks(session);
      }

      // code ≠ 0 表示 TTS 出错
      if (Number(msg.code) && Number(msg.code) !== 0) {
        this.sendClientJson(session.clientWs, {
          type: 'tts_error',
          message: String(msg.message ?? 'Tencent TTS error'),
          code: Number(msg.code),
        });
        this.closeSession(session.sessionId, 'tencent error');
        return;
      }

      // final=1 表示 TTS 合成完毕
      if (Number(msg.final) === 1) {
        this.sendClientJson(session.clientWs, { type: 'tts_final' });
      }
    });

    // TTS 连接出错
    tencentWs.on('error', (error) => {
      this.sendClientJson(session.clientWs, {
        type: 'tts_error',
        message: `Tencent ws error: ${error.message}`,
      });
    });

    // TTS 连接关闭
    tencentWs.on('close', () => {
      session.tencentWs = undefined;
      session.ready = false;
    });
  }

  /**
   * 将等待队列中的文本块全部发送给腾讯云 TTS
   * 在 TTS 就绪后或结束前调用，确保不丢数据
   */
  private flushPendingChunks(session: ClientSession): void {
    if (
      !session.ready ||
      !session.tencentWs ||
      session.tencentWs.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    while (session.pendingChunks.length > 0) {
      const chunk = session.pendingChunks.shift();
      if (!chunk) continue;
      this.sendTencentChunk(session, chunk);
    }
  }

  /**
   * 发送一段文本给腾讯云 TTS 进行语音合成
   * 如果连接异常，重新放回等待队列
   */
  private sendTencentChunk(session: ClientSession, text: string): void {
    if (!session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
      session.pendingChunks.push(text);
      return;
    }

    session.tencentWs.send(
      JSON.stringify({
        session_id: session.sessionId,
        message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        action: 'ACTION_SYNTHESIS',
        data: text,
      }),
    );
  }

  /**
   * 关闭会话：关闭腾讯云 TTS 连接和前端连接，清理会话记录
   */
  private closeSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.closed = true;

    if (session.tencentWs && session.tencentWs.readyState < WebSocket.CLOSING) {
      session.tencentWs.close();
    }
    if (session.clientWs.readyState < WebSocket.CLOSING) {
      this.sendClientJson(session.clientWs, { type: 'tts_closed', reason });
      session.clientWs.close();
    }
    this.sessions.delete(sessionId);
    this.logger.log(`TTS session closed: ${sessionId}, reason: ${reason}`);
  }

  /**
   * 向前端 WebSocket 发送 JSON 消息
   */
  private sendClientJson(
    clientWs: WebSocket,
    payload: Record<string, unknown>,
  ): void {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    clientWs.send(JSON.stringify(payload));
  }

  /**
   * 构建腾讯云 TTS WebSocket 的连接 URL
   * 包含认证参数（SecretId + HMAC-SHA1 签名）
   */
  private buildTencentTtsWsUrl(sessionId: string): string {
    const now = Math.floor(Date.now() / 1000);
    // TTS 接口请求参数
    const params: Record<string, string | number> = {
      Action: 'TextToStreamAudioWSv2', // 接口名：流式语音合成
      AppId: this.appId,
      Codec: 'mp3', // 音频编码格式
      Expired: now + 3600, // 签名过期时间（当前时间 + 1 小时）
      SampleRate: 16000, // 采样率 16kHz
      SecretId: this.secretId,
      SessionId: sessionId,
      Speed: 0, // 语速（0 为正常）
      Timestamp: now,
      VoiceType: this.voiceType, // 音色编号
      Volume: 5, // 音量（0-10）
    };

    // 按照腾讯云签名规范：参数排序 → 拼接 → HMAC-SHA1 签名
    const signStr = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const rawStr = `GETtts.cloud.tencent.com/stream_wsv2?${signStr}`;
    const signature = createHmac('sha1', this.secretKey)
      .update(rawStr)
      .digest('base64');
    const searchParams = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)]),
      ),
      Signature: signature,
    });

    return `wss://tts.cloud.tencent.com/stream_wsv2?${searchParams.toString()}`;
  }
}
