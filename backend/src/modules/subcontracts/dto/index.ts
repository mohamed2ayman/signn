import {
  IsUUID,
  IsString,
  IsEmail,
  IsOptional,
  IsNumber,
  IsDateString,
} from 'class-validator';

export class CreateSubContractDto {
  @IsUUID()
  main_contract_id: string;

  @IsString()
  title: string;

  @IsString()
  scope_description: string;

  @IsString()
  subcontractor_name: string;

  @IsEmail()
  subcontractor_email: string;

  @IsOptional()
  @IsString()
  subcontractor_company?: string;

  @IsOptional()
  @IsString()
  subcontractor_contact_phone?: string;

  @IsOptional()
  @IsNumber()
  contract_value?: number;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class UpdateSubContractDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  scope_description?: string;

  @IsOptional()
  @IsString()
  subcontractor_name?: string;

  @IsOptional()
  @IsEmail()
  subcontractor_email?: string;

  @IsOptional()
  @IsString()
  subcontractor_company?: string;

  @IsOptional()
  @IsString()
  subcontractor_contact_phone?: string;

  @IsOptional()
  @IsNumber()
  contract_value?: number;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;
}

export class UpdateSubContractStatusDto {
  @IsString()
  status: string;

  @IsOptional()
  @IsString()
  note?: string;
}
