import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PortfolioParams {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  userId!: number;
}
