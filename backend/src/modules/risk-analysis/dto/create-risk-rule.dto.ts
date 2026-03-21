import { IsString, IsEnum, IsOptional, IsArray, IsBoolean, MaxLength } from 'class-validator';
import { RiskRuleSeverity } from '../../../database/entities';

export class CreateRiskRuleDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MaxLength(100)
  risk_category: string;

  @IsEnum(RiskRuleSeverity)
  severity: RiskRuleSeverity;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  detection_keywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicable_contract_types?: string[];

  @IsOptional()
  @IsString()
  recommendation_template?: string;
}
