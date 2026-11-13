import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { OrderAccountingService } from './order-accounting.service.js';
import { centsToMoney, moneyToCents } from './order-pricing.js';
import type { SubmitOrderDto } from './submit-order.dto.js';

export interface StoredOrderResponse {
  httpStatus: 201 | 422;
  responseBody: string;
}

interface LockedUser { id: number }

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderAccountingService) private readonly accounting: OrderAccountingService,
  ) {}

  async submit(input: SubmitOrderDto, key: string): Promise<StoredOrderResponse> {
    const normalized = normalizeInput(input);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ method: 'POST', path: '/orders', body: normalized }))
      .digest('hex');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
        const users = await tx.$queryRaw<LockedUser[]>`SELECT id FROM users WHERE id = ${normalized.userId} FOR UPDATE`;
        if (users.length === 0) {
          throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'User not found' } });
        }

        const existing = await tx.idempotencyRequest.findUnique({
          where: { userId_key: { userId: normalized.userId, key } },
          select: { fingerprint: true, httpStatus: true, responseBody: true },
        });
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new ConflictException({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency-Key is already used with a different request' } });
          }
          return { httpStatus: existing.httpStatus as 201 | 422, responseBody: existing.responseBody };
        }

        const assessment = await this.accounting.assess(tx, normalized);
        const status = assessment.decision === 'REJECT' ? 'REJECTED' : normalized.type === 'MARKET' ? 'FILLED' : 'NEW';
        const order = await tx.order.create({
          data: {
            userId: normalized.userId,
            instrumentId: normalized.instrumentId,
            side: normalized.side,
            type: normalized.type,
            size: assessment.size,
            price: assessment.priceARS,
            status,
            rejectionReason: assessment.rejectionReason,
          },
        });
        const orderBody = {
          id: order.id,
          userId: order.userId,
          instrumentId: order.instrumentId,
          side: order.side,
          type: order.type,
          size: order.size,
          priceARS: assessment.priceARS,
          status: order.status,
          datetime: order.datetime.toISOString(),
          rejectionReason: order.rejectionReason,
        };
        const httpStatus = assessment.decision === 'REJECT' ? 422 : 201;
        const responseBody = assessment.decision === 'REJECT'
          ? JSON.stringify({
            error: {
              code: assessment.rejectionReason,
              message: assessment.rejectionReason === 'INSUFFICIENT_CASH' ? 'Insufficient available cash' : 'Insufficient held shares',
            },
            order: orderBody,
          })
          : JSON.stringify({ order: orderBody });
        await tx.idempotencyRequest.create({
          data: { userId: normalized.userId, key, fingerprint, orderId: order.id, httpStatus, responseBody },
        });
        return { httpStatus, responseBody };
      }, { maxWait: 10_000, timeout: 15_000 });
    } catch (error) {
      if (isLockTimeout(error)) {
        throw new ConflictException({ error: { code: 'ORDER_RETRYABLE_CONFLICT', message: 'Order submission is busy; retry with the same Idempotency-Key' } });
      }
      throw error;
    }
  }

  async cancel(orderId: number, userId: number) {
    const updated = await this.prisma.order.updateMany({
      where: { id: orderId, userId, status: 'NEW' },
      data: { status: 'CANCELLED' },
    });
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId } });
    if (!order) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    }
    if (updated.count === 0) {
      throw new ConflictException({ error: { code: 'ORDER_NOT_CANCELLABLE', message: 'Only NEW orders can be cancelled' } });
    }

    return {
      order: {
        id: order.id,
        userId: order.userId,
        instrumentId: order.instrumentId,
        side: order.side,
        type: order.type,
        size: order.size,
        priceARS: centsToMoney(moneyToCents(order.price.toString(), 'price')),
        status: order.status,
        datetime: order.datetime.toISOString(),
        rejectionReason: order.rejectionReason,
      },
    };
  }
}

function normalizeInput(input: SubmitOrderDto): SubmitOrderDto {
  const hasSize = input.size !== undefined;
  const hasAmount = input.amountARS !== undefined;
  if (hasSize === hasAmount) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Provide exactly one of size or amountARS' } });
  }
  if (input.type === 'MARKET' && input.limitPriceARS !== undefined) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'MARKET orders cannot include limitPriceARS' } });
  }
  if (input.type === 'LIMIT' && input.limitPriceARS === undefined) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'LIMIT orders require limitPriceARS' } });
  }

  return {
    userId: input.userId,
    instrumentId: input.instrumentId,
    side: input.side,
    type: input.type,
    ...(hasSize ? { size: input.size } : { amountARS: centsToMoney(moneyToCents(input.amountARS, 'amountARS')) }),
    ...(input.type === 'LIMIT' ? { limitPriceARS: centsToMoney(moneyToCents(input.limitPriceARS, 'limitPriceARS')) } : {}),
  };
}

function isLockTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  if (record.code === '55P03') return true;
  if (record.meta && isLockTimeout(record.meta)) return true;
  if (record.cause && isLockTimeout(record.cause)) return true;
  return false;
}
