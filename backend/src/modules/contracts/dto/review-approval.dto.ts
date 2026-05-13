import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApproverStatus } from '../../../database/entities';

export class ReviewApprovalDto {
  @IsEnum([ApproverStatus.APPROVED, ApproverStatus.REJECTED])
  decision: ApproverStatus.APPROVED | ApproverStatus.REJECTED;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  comment?: string;
}
