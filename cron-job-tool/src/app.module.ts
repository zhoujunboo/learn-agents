import { Inject, Module, OnApplicationBootstrap } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiModule } from './ai/ai.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { User } from './users/entities/user.entity';
import {
  CronExpression,
  ScheduleModule,
  SchedulerRegistry,
} from '@nestjs/schedule';
import { CronJob } from 'cron';
import { JobModule } from './job/job.module';
import { Job } from './job/entities/job.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',
      password: 'admin',
      database: 'hello',
      synchronize: true,
      logging: true,
      entities: [User, Job],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    AiModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST'),
          port: Number(configService.get<string>('MAIL_PORT')),
          secure: configService.get<string>('MAIL_SECURE') === 'true',
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: configService.get<string>('MAIL_FROM'),
        },
      }),
    }),
    UsersModule,
    JobModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})

// 测试定时任务的代码
export class AppModule implements OnApplicationBootstrap {
  @Inject(SchedulerRegistry)
  schedulerRegistry: SchedulerRegistry;

  // 这三种定时任务，跟openclaw里的 cron / every / at 含义一致
  async onApplicationBootstrap() {
    // 就三种定时任务
    // 每一秒执行
    const job = new CronJob(CronExpression.EVERY_SECOND, () => {
      console.log('run job');
    });

    this.schedulerRegistry.addCronJob('job1', job);
    job.start();
    setTimeout(() => {
      this.schedulerRegistry.deleteCronJob('job1');
    }, 5000);

    // 每多长时间执行一次
    const intervalRef = setInterval(() => {
      console.log('run interval job');
    }, 1000);
    this.schedulerRegistry.addInterval('interval1', intervalRef);
    setTimeout(() => {
      this.schedulerRegistry.deleteInterval('interval1');
    }, 5000);

    // 到时间执行
    const timeoutRef = setTimeout(() => {
      console.log('run timeout job');
    }, 3000);
    this.schedulerRegistry.addTimeout('timeout1', timeoutRef);
    setTimeout(() => {
      this.schedulerRegistry.deleteTimeout('timeout1');
    }, 5000);
  }
}
