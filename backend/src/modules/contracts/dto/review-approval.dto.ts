import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApproverStatus } from '../../../database/entities';

export class ReviewApprovalDto {
  @IsEnum([ApproverStatus.APPROVED, ApproverStatus.REJECTED])
  decision: ApproverStatus.APPROVED | ApproverStatus.REJECTED;

  @IsOptional()
  @IsString()
  comment?: string;
}
