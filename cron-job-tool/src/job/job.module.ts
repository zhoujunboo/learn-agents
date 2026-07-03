import { forwardRef, Module } from '@nestjs/common';
import { JobService } from './job.service';
import { ToolModule } from '../tool/tool.module';
@Module({
  imports: [forwardRef(() => ToolModule)],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}
