import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EntityManager } from 'typeorm';
import { Job } from './entities/job.entity';
// TODO: job-agent.service 文件不存在，需要先创建或直接注入 AiService
//   this.jobAgentService.runJob(instruction) 本质上就是调用 AI 处理指令
//   可用方式: @Inject(AiService) private readonly aiService: AiService;
//   然后 this.jobAgentService.runJob(x) 替换为 this.aiService.runChain(x)

/**
 * 定时任务服务
 * 管理三种类型的定时任务：cron（cron表达式）、every（固定间隔）、at（一次性）
 * 启动时自动恢复所有已启用的任务
 */
@Injectable()
export class JobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobService.name);

  @Inject(EntityManager)
  private readonly entityManager: EntityManager;

  @Inject(SchedulerRegistry)
  private readonly schedulerRegistry: SchedulerRegistry;

  // TODO: 缺少 jobAgentService 注入
  //   用法: this.jobAgentService.runJob(instruction)
  //   推荐: 注入 AiService → @Inject(AiService) private readonly aiService: AiService;
  //   然后 this.jobAgentService.runJob(x) 改为 this.aiService.runChain(x)
  private readonly jobAgentService: any;

  /**
   * 应用启动时自动执行 —— 从数据库加载所有已启用的任务并恢复运行
   */
  async onApplicationBootstrap() {
    // 查出所有已启用的任务
    const enabledJobs = await this.entityManager.find(Job, {
      where: { isEnabled: true },
    });
    // 拿到调度器里已有的任务清单，避免重复注册
    const cronJobs = this.schedulerRegistry.getCronJobs();
    const intervals = this.schedulerRegistry.getIntervals();
    const timeouts = this.schedulerRegistry.getTimeouts();

    for (const job of enabledJobs) {
      // 如果调度器里已经有了，就跳过
      const alreadyRegistered =
        (job.type === 'cron' && cronJobs.has(job.id)) ||
        (job.type === 'every' && intervals.includes(job.id)) ||
        (job.type === 'at' && timeouts.includes(job.id));
      if (alreadyRegistered) continue;

      await this.startRuntime(job);
    }
  }

  /**
   * 获取所有任务列表，并标记每个任务当前是否正在运行
   */
  async listJobs() {
    const jobs = await this.entityManager.find(Job, {
      order: { createdAt: 'DESC' },
    });

    const cronJobs = this.schedulerRegistry.getCronJobs();
    const intervalNames = this.schedulerRegistry.getIntervals();
    const timeoutNames = this.schedulerRegistry.getTimeouts();

    return jobs.map((job) => {
      // 判断任务是否真的在跑：已启用 + 在调度器里有记录
      const running =
        job.isEnabled &&
        ((job.type === 'cron' && cronJobs.has(job.id)) ||
          (job.type === 'every' && intervalNames.includes(job.id)) ||
          (job.type === 'at' && timeoutNames.includes(job.id)));

      return {
        ...job, // 数据库里的原始字段
        running, // 额外加一个运行状态标记
      };
    });
  }

  /**
   * 添加一个新任务
   * 支持三种类型，存到数据库后如果启用了立即开始跑
   */
  async addJob(
    input:
      | {
          type: 'cron'; // cron 表达式，如 "0 9 * * *"
          instruction: string;
          cron: string;
          isEnabled?: boolean;
        }
      | {
          type: 'every'; // 固定间隔（毫秒）
          instruction: string;
          everyMs: number;
          isEnabled?: boolean;
        }
      | {
          type: 'at'; // 指定时间执行一次
          instruction: string;
          at: Date;
          isEnabled?: boolean;
        },
  ) {
    // 建实体，不同的 type 存不同的字段
    const entity = this.entityManager.create(Job, {
      instruction: input.instruction,
      type: input.type,
      cron: input.type === 'cron' ? input.cron : null,
      everyMs: input.type === 'every' ? input.everyMs : null,
      at: input.type === 'at' ? input.at : null,
      isEnabled: input.isEnabled ?? true,
      lastRun: null,
    });

    const saved = await this.entityManager.save(Job, entity);

    if (saved.isEnabled) {
      await this.startRuntime(saved); // 存完立即启动
    }

    return saved;
  }

  /**
   * 启用 / 停用一个任务（开关）
   * @param enabled 不传就取反
   */
  async toggleJob(jobId: string, enabled?: boolean) {
    const job = await this.entityManager.findOne(Job, { where: { id: jobId } });
    if (!job) throw new NotFoundException(`Job not found: ${jobId}`);

    const nextEnabled = enabled ?? !job.isEnabled; // 不传就翻转
    if (job.isEnabled !== nextEnabled) {
      job.isEnabled = nextEnabled;
      await this.entityManager.save(Job, job);
    }

    if (job.isEnabled) {
      await this.startRuntime(job); // 开
    } else {
      this.stopRuntime(job); // 关
    }

    return job;
  }

  // ==================== 启动 / 停止（内部方法） ====================

  /**
   * 根据任务类型，把任务注册到 NestJS 的调度器里开始跑
   */
  private async startRuntime(job: Job) {
    // ---------- cron 类型 ----------
    if (job.type === 'cron') {
      const cronJobs = this.schedulerRegistry.getCronJobs();
      const existing = cronJobs.get(job.id);
      if (existing) {
        existing.start(); // 只是暂停了，恢复一下就好
        return;
      }

      const runtimeJob = this.createCronJob(job);
      this.schedulerRegistry.addCronJob(job.id, runtimeJob);
      runtimeJob.start();
      return;
    }

    // ---------- every 类型 — 固定间隔重复执行 ----------
    if (job.type === 'every') {
      const names = this.schedulerRegistry.getIntervals();
      if (names.includes(job.id)) return;

      if (typeof job.everyMs !== 'number' || job.everyMs <= 0) {
        throw new Error(`Invalid everyMs for job ${job.id}`);
      }

      const ref = setInterval(async () => {
        this.logger.log(`run job ${job.id}, ${job.instruction}`);
        await this.entityManager.update(Job, job.id, { lastRun: new Date() });
      }, job.everyMs);

      this.schedulerRegistry.addInterval(job.id, ref);
      return;
    }

    // ---------- at 类型 — 指定时间只执行一次 ----------
    if (job.type === 'at') {
      const names = this.schedulerRegistry.getTimeouts();
      if (names.includes(job.id)) return;

      if (!job.at) {
        throw new Error(`Invalid at for job ${job.id}`);
      }

      const delay = Math.max(0, job.at.getTime() - Date.now());
      const ref = setTimeout(async () => {
        this.logger.log(`run job ${job.id}, ${job.instruction}`);
        await this.entityManager.update(Job, job.id, {
          lastRun: new Date(),
          isEnabled: false, // 一次性任务：执行完自动停用
        });

        try {
          this.schedulerRegistry.deleteTimeout(job.id);
        } catch (e) {
          // ignore
        }
      }, delay);

      this.schedulerRegistry.addTimeout(job.id, ref);
      return;
    }
  }

  /**
   * 根据任务类型停止运行（不删数据库记录）
   */
  private stopRuntime(job: Job) {
    if (job.type === 'cron') {
      const cronJobs = this.schedulerRegistry.getCronJobs();
      const runtimeJob = cronJobs.get(job.id);
      if (runtimeJob) runtimeJob.stop(); // 只暂停，不删除注册
      return;
    }

    if (job.type === 'every') {
      try {
        this.schedulerRegistry.deleteInterval(job.id);
      } catch {
        // ignore
      }
      return;
    }

    if (job.type === 'at') {
      try {
        this.schedulerRegistry.deleteTimeout(job.id);
      } catch {
        // ignore
      }
      return;
    }
  }

  /**
   * 创建一个 cron 定时任务
   * 到了时间就执行一次，记录 lastRun，然后调用 AI Agent 跑任务指令
   */
  private createCronJob(job: Job) {
    const cronExpr = job.cron ?? '';
    return new CronJob(cronExpr, async () => {
      this.logger.log(`run job ${job.id}, ${job.instruction}`);
      await this.entityManager.update(Job, job.id, { lastRun: new Date() });
    });
  }
}
