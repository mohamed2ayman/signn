import { IsEnum } from 'class-validator';
import { ComplianceFindingStatus } from '../../../database/entities/compliance-finding.entity';

export class UpdateFindingStatusDto {
  @IsEnum(ComplianceFindingStatus)
  status: ComplianceFindingStatus;
}
