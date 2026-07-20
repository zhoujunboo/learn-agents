import { Injectable } from '@nestjs/common';
import { JwtPayload } from '../common/interfaces/api-response.interface';

@Injectable()
export class AuthService {
  /** 模拟 Token 与用户映射，实际项目应使用 JWT + 数据库 */
  private readonly tokenMap: Record<string, JwtPayload> = {
    'admin-token-123': { id: 1, username: 'admin', role: 'admin' },
    'user-token-456': { id: 2, username: 'zhangsan', role: 'user' },
  };

  validateToken(token: string): JwtPayload | null {
    return this.tokenMap[token] ?? null;
  }
}
