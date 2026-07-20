import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { JwtPayload } from '../interfaces/api-response.interface';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      params: { id?: string };
      user?: JwtPayload;
    }>();

    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('请先登录，携带合法 Token');
    }

    const user = this.authService.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Token 无效或已过期');
    }

    request.user = user;

    const targetId = request.params.id;
    if (targetId !== undefined) {
      const id = Number.parseInt(targetId, 10);
      if (user.role !== 'admin' && user.id !== id) {
        throw new ForbiddenException('无权访问其他用户信息');
      }
    }

    return true;
  }

  private extractToken(authorization?: string): string | null {
    if (!authorization) {
      return null;
    }

    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }
}
