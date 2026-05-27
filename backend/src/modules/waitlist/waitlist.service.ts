import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductWaitlist } from './entities/product-waitlist.entity';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectRepository(ProductWaitlist)
    private readonly repo: Repository<ProductWaitlist>,
  ) {}

  /**
   * Insert a waitlist entry.
   *
   * On duplicate (email + product_name already exists): return { success: true }
   * silently — NEVER throw 409 or any error that exposes whether the email
   * exists. This is a public unauthenticated endpoint; enumeration is a risk.
   *
   * On any other DB error: log and rethrow — lesson #31.
   */
  async create(dto: CreateWaitlistEntryDto): Promise<{ success: true }> {
    try {
      const entry = this.repo.create({
        email: dto.email.toLowerCase().trim(),
        product_name: dto.product_name,
      });
      await this.repo.save(entry);
    } catch (err: any) {
      // PostgreSQL unique violation: code 23505
      // Return success silently — never expose whether email already exists
      if (err?.code === '23505') {
        return { success: true };
      }
      // Any other DB error: log and rethrow (lesson #31)
      this.logger.error(
        `[WaitlistService.create] Failed to save waitlist entry: ${err.message}`,
        err.stack,
      );
      throw err;
    }
    return { success: true };
  }

  /**
   * Return all waitlist entries, optionally filtered by product_name.
   * Ordered by created_at DESC (most recent first).
   */
  async findAll(productName?: string): Promise<ProductWaitlist[]> {
    const qb = this.repo
      .createQueryBuilder('w')
      .orderBy('w.created_at', 'DESC');

    if (productName) {
      qb.where('w.product_name = :productName', { productName });
    }

    return qb.getMany();
  }
}
