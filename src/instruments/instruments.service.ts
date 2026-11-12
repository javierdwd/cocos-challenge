import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface InstrumentSearchResponse {
  data: Array<{ id: number; ticker: string; name: string; type: string }>;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

@Injectable()
export class InstrumentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(query: string, page: number, pageSize: number): Promise<InstrumentSearchResponse> {
    const literalQuery = query.replace(/[\\%_]/g, '\\$&');
    const where = {
      type: 'ACCIONES',
      NOT: { ticker: { equals: 'ARS', mode: 'insensitive' as const } },
      OR: [
        { ticker: { contains: literalQuery, mode: 'insensitive' as const } },
        { name: { contains: literalQuery, mode: 'insensitive' as const } },
      ],
    };
    const skip = (page - 1) * pageSize;
    const totalItems = await this.prisma.instrument.count({ where });
    const data = skip > 2_147_483_647
      ? []
      : await this.prisma.instrument.findMany({
          where,
          select: { id: true, ticker: true, name: true, type: true },
          orderBy: [{ ticker: 'asc' }, { id: 'asc' }],
          skip,
          take: pageSize,
        });

    return {
      data,
      pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
    };
  }
}
