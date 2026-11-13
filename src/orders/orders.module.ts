import { Module } from '@nestjs/common';
import { OrderAccountingService } from './order-accounting.service.js';

@Module({
  providers: [OrderAccountingService],
  exports: [OrderAccountingService],
})
export class OrdersModule {}
