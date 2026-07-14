import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  name: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // ====== 一对多关系：一个用户有多个对话 ======
  // 参数说明：
  //   () => Conversation - 关联的对话实体
  //   (conversation) => conversation.user - 反向引用（对话中的 user 字段指向此用户）
  @OneToMany(() => Conversation, (conversation) => conversation.user)
  conversations: Conversation[];
}
