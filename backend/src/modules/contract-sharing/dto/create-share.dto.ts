import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateShareDto {
  @IsUUID()
  contract_id: string;

  @IsEmail()
  @MaxLength(255)
  shared_with_email: string;

  @IsOptional()
  @IsIn(['view', 'comment', 'edit'])
  permission?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expires_in_days?: number;
}
