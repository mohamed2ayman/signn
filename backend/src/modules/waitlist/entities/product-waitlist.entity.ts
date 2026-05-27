import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('product_waitlist')
export class ProductWaitlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 50 })
  product_name: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
