import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class CancelOrderParams {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  orderId!: number;
}

export class CancelOrderDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  userId!: number;
}
