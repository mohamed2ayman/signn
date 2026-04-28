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

@Entity('support_chat_notes')
@Index(['chat_id', 'created_at'])
export class SupportChatNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  chat_id: string;

  @ManyToOne(() => SupportChat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: SupportChat;

  @Column({ type: 'uuid' })
  ops_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ops_id' })
  ops: User;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
