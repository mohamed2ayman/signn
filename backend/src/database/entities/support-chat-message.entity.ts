import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { SupportChat } from './support-chat.entity';

export enum SupportChatSenderRole {
  USER = 'USER',
  OPS = 'OPS',
  SYSTEM = 'SYSTEM',
}

@Entity('support_chat_messages')
@Index(['chat_id', 'created_at'])
export class SupportChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  chat_id: string;

  @ManyToOne(() => SupportChat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: SupportChat;

  @Column({ type: 'uuid', nullable: true })
  sender_id: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ type: 'varchar', length: 20 })
  sender_role: SupportChatSenderRole;

  @Column({ type: 'text', default: '' })
  body: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  attachment_url: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  attachment_name: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  attachment_mime: string | null;

  @Column({ type: 'integer', nullable: true })
  attachment_size: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
