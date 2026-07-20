import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [UserService, AuthGuard],
})
export class UserModule {}
