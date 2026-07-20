import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtTestController } from './jwt-test.controller';
import { JwtTestService } from './jwt-test.service';

@Module({
  imports: [
    JwtModule.register({
      secret: 'jwt-test-secret-key',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [JwtTestController],
  providers: [JwtTestService],
})
export class JwtTestModule {}
