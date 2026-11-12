import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

function parsePageNumber(value: unknown): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
}

export class SearchInstrumentsQuery {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  query!: string;

  @Transform(({ value }: { value: unknown }) => parsePageNumber(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Transform(({ value }: { value: unknown }) => parsePageNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
