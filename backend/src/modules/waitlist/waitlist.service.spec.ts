import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WaitlistService } from './waitlist.service';
import { ProductWaitlist } from './entities/product-waitlist.entity';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const mockEntry: ProductWaitlist = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'test@example.com',
  product_name: 'VENDRIX',
  created_at: new Date('2026-05-27T10:00:00.000Z'),
};

const mockQb: any = {
  orderBy: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([mockEntry]),
};

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb),
};

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

describe('WaitlistService', () => {
  let service: WaitlistService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQb.where.mockReturnThis();
    mockQb.getMany.mockResolvedValue([mockEntry]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WaitlistService,
        { provide: getRepositoryToken(ProductWaitlist), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<WaitlistService>(WaitlistService);
  });

  // ─── create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('inserts a new entry and returns { success: true }', async () => {
      mockRepo.create.mockReturnValue(mockEntry);
      mockRepo.save.mockResolvedValue(mockEntry);

      const dto: CreateWaitlistEntryDto = {
        email: 'user@example.com',
        product_name: 'VENDRIX',
      };

      const result = await service.create(dto);
      expect(result).toEqual({ success: true });
      expect(mockRepo.save).toHaveBeenCalledTimes(1);
    });

    it('returns { success: true } silently on duplicate (23505) — never throws', async () => {
      mockRepo.create.mockReturnValue(mockEntry);
      const dupError = Object.assign(new Error('duplicate key'), { code: '23505' });
      mockRepo.save.mockRejectedValue(dupError);

      const dto: CreateWaitlistEntryDto = {
        email: 'existing@example.com',
        product_name: 'VENDRIX',
      };

      // Must NOT throw — returns success silently (enumeration protection)
      await expect(service.create(dto)).resolves.toEqual({ success: true });
    });

    it('rethrows non-duplicate DB errors (lesson #31)', async () => {
      mockRepo.create.mockReturnValue(mockEntry);
      const dbError = Object.assign(new Error('connection refused'), { code: '08006' });
      mockRepo.save.mockRejectedValue(dbError);

      const dto: CreateWaitlistEntryDto = {
        email: 'user@example.com',
        product_name: 'SPANTEC',
      };

      await expect(service.create(dto)).rejects.toThrow('connection refused');
    });
  });

  // ─── findAll() ────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns all entries when no product filter is given', async () => {
      const result = await service.findAll();
      expect(result).toEqual([mockEntry]);
      // No where() clause should be applied
      expect(mockQb.where).not.toHaveBeenCalled();
    });

    it('filters by product_name when provided', async () => {
      const filtered = [{ ...mockEntry, product_name: 'CLAIMX' }];
      mockQb.getMany.mockResolvedValue(filtered);

      const result = await service.findAll('CLAIMX');
      expect(result).toEqual(filtered);
      expect(mockQb.where).toHaveBeenCalledWith(
        'w.product_name = :productName',
        { productName: 'CLAIMX' },
      );
    });
  });
});
