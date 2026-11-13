import { BadRequestException, Body, Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { SubmitOrderDto } from './submit-order.dto.js';

interface JsonResponse {
  status(code: number): JsonResponse;
  type(contentType: string): JsonResponse;
  send(body: string): void;
}

@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Post()
  async submitOrder(
    @Body() body: SubmitOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res() response: JsonResponse,
  ): Promise<void> {
    if (typeof key !== 'string' || key.trim().length === 0 || key.length > 255) {
      throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key must be a nonempty string of at most 255 characters' } });
    }
    const result = await this.ordersService.submit(body, key);
    response.status(result.httpStatus).type('application/json').send(result.responseBody);
  }
}
