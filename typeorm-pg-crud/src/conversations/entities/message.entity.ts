import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

// 消息角色枚举
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'conversation_id' })
  conversationId: number;

  @Column({
    type: 'text',
    enum: MessageRole,
  })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column('vector', { length: 1024, nullable: true })
  embedding: number[] | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // ====== 多对一关系：多个消息属于一个对话 ======
  // 参数说明：
  //   () => Conversation - 关联的对话实体
  //   (conversation) => conversation.messages - 反向引用（对话中的 messages 字段）
  //   { onDelete: 'CASCADE' } - 删除对话时自动删除所有相关消息
  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  // @JoinColumn：指定外键列名为 conversation_id
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;
}
