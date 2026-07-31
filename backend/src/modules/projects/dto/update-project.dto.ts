import { IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  objective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  country?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  /**
   * Party Foundation Slice 1a — the project-level DEFAULT party role a
   * contract inherits for contracts.host_party_role_code. Registry-validated
   * in ProjectsService.update() against ACTIVE rows (unknown AND inactive
   * codes both rejected). Send '' to clear it back to NULL.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  default_party_role_code?: string;
}
