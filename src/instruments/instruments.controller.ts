import { Controller, Get, Inject, Query } from '@nestjs/common';
import { InstrumentsService, type InstrumentSearchResponse } from './instruments.service.js';
import { SearchInstrumentsQuery } from './search-instruments.query.js';

@Controller('instruments')
export class InstrumentsController {
  constructor(@Inject(InstrumentsService) private readonly instrumentsService: InstrumentsService) {}

  @Get()
  search(@Query() query: SearchInstrumentsQuery): Promise<InstrumentSearchResponse> {
    return this.instrumentsService.search(query.query, query.page, query.pageSize);
  }
}
