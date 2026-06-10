import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ChatSession } from './chat-session.entity';

export enum ChatMessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

/**
 * Async chat lifecycle (Phase 7.27). USER messages are created COMPLETED
 * (their text is already final). The ASSISTANT placeholder starts PENDING and
 * is advanced by GET /chat/messages/:id/status as the AI job progresses.
 */
export enum ChatMessageStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  session_id: string;

  @Column({ type: 'uuid', nullable: true })
  contract_id: string | null;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  org_id: string;

  @Column({ type: 'varchar', length: 20 })
  role: ChatMessageRole;

  /** Nullable: the assistant placeholder row exists before the AI reply lands. */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'jsonb', nullable: true })
  citations: Record<string, any>[] | null;

  /** Async lifecycle status (Phase 7.27). Defaults COMPLETED for USER turns. */
  @Column({ type: 'varchar', length: 20, default: ChatMessageStatus.COMPLETED })
  status: ChatMessageStatus;

  /** ai-backend Celery job id for the assistant turn (null for USER turns). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  job_id: string | null;

  /** Populated when status = FAILED. */
  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => ChatSession, (session) => session.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: ChatSession;
}
