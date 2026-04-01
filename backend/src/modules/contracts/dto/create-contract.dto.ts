import { IsString, IsEnum, IsUUID, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ContractType, LicenseOrganization } from '../../../database/entities';

export class CreateContractDto {
  @IsUUID()
  project_id: string;

  @IsString()
  @MaxLength(500)
  name: string;

  @IsEnum(ContractType)
  contract_type: ContractType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  party_type?: string;

  @IsOptional()
  @IsBoolean()
  license_acknowledged?: boolean;

  @IsOptional()
  @IsEnum(LicenseOrganization)
  license_organization?: LicenseOrganization;
}
