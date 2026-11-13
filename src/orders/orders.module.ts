import { Module } from '@nestjs/common';
import { OrderAccountingService } from './order-accounting.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  controllers: [OrdersController],
  providers: [OrderAccountingService, OrdersService],
  exports: [OrderAccountingService],
})
export class OrdersModule {}
