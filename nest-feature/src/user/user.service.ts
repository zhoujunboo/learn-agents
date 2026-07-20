import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  private users: User[] = [
    {
      id: 1,
      username: 'admin',
      name: '管理员',
      age: 30,
      role: 'admin',
    },
    {
      id: 2,
      username: 'zhangsan',
      name: '张三',
      age: 25,
      role: 'user',
    },
  ];

  private nextId = 3;

  create(createUserDto: CreateUserDto): User {
    const user: User = {
      id: this.nextId++,
      username: createUserDto.username,
      name: createUserDto.name,
      age: createUserDto.age,
      role: 'user',
    };
    this.users.push(user);
    return user;
  }

  findAll(): User[] {
    return this.users;
  }

  findOne(id: number): User {
    const user = this.users.find((item) => item.id === id);
    if (!user) {
      throw new NotFoundException(`用户 #${id} 不存在`);
    }
    return user;
  }

  update(id: number, updateUserDto: UpdateUserDto): User {
    const user = this.findOne(id);
    Object.assign(user, updateUserDto);
    return user;
  }

  remove(id: number): User {
    const index = this.users.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new NotFoundException(`用户 #${id} 不存在`);
    }
    const [removed] = this.users.splice(index, 1);
    return removed;
  }
}
