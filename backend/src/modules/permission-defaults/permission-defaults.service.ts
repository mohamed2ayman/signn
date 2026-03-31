import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  PermissionDefault,
  JobTitle,
  PermissionLevel,
  JOB_TITLE_DEFAULT_PERMISSION,
} from '../../database/entities';
import { UpdatePermissionDefaultDto } from './dto/update-permission-default.dto';

export interface PermissionDefaultEntry {
  job_title: string;
  permission_level: PermissionLevel;
  is_custom: boolean;
}

@Injectable()
export class PermissionDefaultsService {
  constructor(
    @InjectRepository(PermissionDefault)
    private readonly permissionDefaultRepository: Repository<PermissionDefault>,
  ) {}

  /**
   * Returns the full matrix: all job titles with their current effective
   * default permission level. Merges hardcoded defaults with admin overrides.
   */
  async getAll(): Promise<PermissionDefaultEntry[]> {
    // Get all admin-configured overrides
    const overrides = await this.permissionDefaultRepository.find();
    const overrideMap = new Map<string, string>();
    for (const o of overrides) {
      overrideMap.set(o.job_title, o.permission_level);
    }

    // Build the full list from all known job titles
    const result: PermissionDefaultEntry[] = [];
    for (const jt of Object.values(JobTitle)) {
      const hardcoded = JOB_TITLE_DEFAULT_PERMISSION[jt];
      const override = overrideMap.get(jt);
      result.push({
        job_title: jt,
        permission_level: (override as PermissionLevel) || hardcoded,
        is_custom: !!override,
      });
    }

    return result;
  }

  /**
   * Update the default permission level for a specific job title.
   * This only affects NEW project member assignments — existing
   * per-project overrides are not changed.
   */
  async update(dto: UpdatePermissionDefaultDto): Promise<PermissionDefaultEntry> {
    let existing = await this.permissionDefaultRepository.findOne({
      where: { job_title: dto.job_title },
    });

    if (existing) {
      existing.permission_level = dto.permission_level;
      await this.permissionDefaultRepository.save(existing);
    } else {
      existing = this.permissionDefaultRepository.create({
        job_title: dto.job_title,
        permission_level: dto.permission_level,
      });
      await this.permissionDefaultRepository.save(existing);
    }

    return {
      job_title: dto.job_title,
      permission_level: dto.permission_level,
      is_custom: true,
    };
  }

  /**
   * Reset a job title's default back to the hardcoded value
   * (removes the admin override).
   */
  async reset(jobTitle: string): Promise<PermissionDefaultEntry> {
    await this.permissionDefaultRepository.delete({ job_title: jobTitle });

    const jobTitleEnum = Object.values(JobTitle).find(
      (jt) => jt === jobTitle,
    ) as JobTitle | undefined;

    const hardcoded = jobTitleEnum
      ? JOB_TITLE_DEFAULT_PERMISSION[jobTitleEnum]
      : PermissionLevel.VIEWER;

    return {
      job_title: jobTitle,
      permission_level: hardcoded,
      is_custom: false,
    };
  }
}
