import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtTestModule } from './jwt-test/jwt-test.module';
import { UserModule } from './user/user.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    AuthModule,
    UserModule,
    JwtTestModule,
    // 在这里引入，并生成了全局模块，就不用在每个模块单独引入了
    JwtModule.register({
      global: true,
      secret: 'jwt-test-secret-key',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
