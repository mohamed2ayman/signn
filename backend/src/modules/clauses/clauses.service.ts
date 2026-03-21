import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Clause } from '../../database/entities';
import { CreateClauseDto, UpdateClauseDto } from './dto';

@Injectable()
export class ClausesService {
  constructor(
    @InjectRepository(Clause)
    private readonly clauseRepository: Repository<Clause>,
  ) {}

  async findAll(
    orgId: string,
    filters?: {
      clause_type?: string;
      search?: string;
      is_active?: boolean;
    },
  ): Promise<Clause[]> {
    const qb = this.clauseRepository
      .createQueryBuilder('clause')
      .leftJoinAndSelect('clause.creator', 'creator')
      .where('(clause.organization_id = :orgId OR clause.organization_id IS NULL)', { orgId })
      .andWhere('clause.parent_clause_id IS NULL'); // Only get latest versions

    if (filters?.clause_type) {
      qb.andWhere('clause.clause_type = :clauseType', { clauseType: filters.clause_type });
    }

    if (filters?.search) {
      qb.andWhere(
        '(clause.title ILIKE :search OR clause.content ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    if (filters?.is_active !== undefined) {
      qb.andWhere('clause.is_active = :isActive', { isActive: filters.is_active });
    } else {
      qb.andWhere('clause.is_active = true');
    }

    qb.orderBy('clause.created_at', 'DESC');

    return qb.getMany();
  }

  async findById(id: string, orgId: string): Promise<Clause> {
    const clause = await this.clauseRepository.findOne({
      where: { id },
      relations: ['creator'],
    });

    if (!clause) {
      throw new NotFoundException('Clause not found');
    }

    return clause;
  }

  async create(
    dto: CreateClauseDto,
    userId: string,
    orgId: string,
  ): Promise<Clause> {
    const clause = this.clauseRepository.create({
      ...dto,
      organization_id: orgId,
      created_by: userId,
      version: 1,
      is_active: true,
    });

    return this.clauseRepository.save(clause);
  }

  async update(
    id: string,
    dto: UpdateClauseDto,
    orgId: string,
  ): Promise<Clause> {
    const clause = await this.findById(id, orgId);

    if (dto.title !== undefined) clause.title = dto.title;
    if (dto.content !== undefined) clause.content = dto.content;
    if (dto.clause_type !== undefined) clause.clause_type = dto.clause_type;
    if (dto.is_active !== undefined) clause.is_active = dto.is_active;

    return this.clauseRepository.save(clause);
  }

  async createNewVersion(
    id: string,
    dto: CreateClauseDto,
    userId: string,
    orgId: string,
  ): Promise<Clause> {
    const currentClause = await this.findById(id, orgId);

    // Deactivate the current clause
    currentClause.is_active = false;
    await this.clauseRepository.save(currentClause);

    // Create a new version
    const newClause = this.clauseRepository.create({
      ...dto,
      organization_id: orgId,
      created_by: userId,
      parent_clause_id: currentClause.id,
      version: currentClause.version + 1,
      is_active: true,
    });

    return this.clauseRepository.save(newClause);
  }

  async getVersionHistory(id: string, orgId: string): Promise<Clause[]> {
    const clause = await this.findById(id, orgId);

    // Find all versions in the chain
    const versions: Clause[] = [clause];
    let currentId = clause.parent_clause_id;

    while (currentId) {
      const parent = await this.clauseRepository.findOne({
        where: { id: currentId },
        relations: ['creator'],
      });
      if (parent) {
        versions.push(parent);
        currentId = parent.parent_clause_id;
      } else {
        break;
      }
    }

    // Also find children (newer versions)
    const children = await this.clauseRepository.find({
      where: { parent_clause_id: id },
      relations: ['creator'],
      order: { version: 'ASC' },
    });
    versions.push(...children);

    // Sort by version number
    return versions.sort((a, b) => a.version - b.version);
  }

  async delete(id: string, orgId: string): Promise<void> {
    const clause = await this.findById(id, orgId);
    clause.is_active = false;
    await this.clauseRepository.save(clause);
  }

  async getClauseTypes(orgId: string): Promise<string[]> {
    const result = await this.clauseRepository
      .createQueryBuilder('clause')
      .select('DISTINCT clause.clause_type', 'clause_type')
      .where('(clause.organization_id = :orgId OR clause.organization_id IS NULL)', { orgId })
      .andWhere('clause.clause_type IS NOT NULL')
      .getRawMany();

    return result.map((r) => r.clause_type);
  }
}
