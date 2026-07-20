import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/api-response.interface';
import { ParseAgePipe } from '../common/pipes/parse-age.pipe';
import { ParsePositiveIntPipe } from '../common/pipes/parse-positive-int.pipe';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  findAll() {
    return this.userService.findAll();
  }

  /** Pipe 演示：age 查询参数自动从字符串转为数字 */
  @Get('age-demo')
  ageDemo(@Query('age', ParseAgePipe) age: number) {
    return { age, type: typeof age };
  }

  /** Guard 演示：必须携带 Token；普通用户只能查自己，管理员可查全部 */
  @Get(':id')
  @UseGuards(AuthGuard)
  findOne(
    @Param('id', ParsePositiveIntPipe) id: number,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return {
      ...this.userService.findOne(id),
      requestedBy: currentUser.username,
    };
  }

  /** Guard 演示：必须携带 Token；普通用户只能改自己，管理员可改全部 */
  @Patch(':id')
  @UseGuards(AuthGuard)
  update(
    @Param('id', ParsePositiveIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return {
      ...this.userService.update(id, updateUserDto),
      updatedBy: currentUser.username,
    };
  }

  @Delete(':id')
  remove(@Param('id', ParsePositiveIntPipe) id: number) {
    return this.userService.remove(id);
  }
}
