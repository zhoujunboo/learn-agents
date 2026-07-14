import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Message } from './message.entity';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // ====== 多对一关系：多个对话属于一个用户 ======
  // 参数说明：
  //   () => User - 关联的用户实体
  //   (user) => user.conversations - 反向引用（用户中的 conversations 字段）
  //   { onDelete: 'CASCADE' } - 删除用户时自动删除所有相关对话
  @ManyToOne(() => User, (user) => user.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' }) // 外键列名
  user: User;

  // ====== 一对多关系：一个对话有多个消息 ======
  // 参数说明：
  //   () => Message - 关联的消息实体
  //   (message) => message.conversation - 反向引用（消息中的 conversation 字段）
  @OneToMany(() => Message, (message) => message.conversation)
  messages: Message[];
}
