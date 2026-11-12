import { Controller, Get, Inject, Param } from '@nestjs/common';
import { PortfolioParams } from './portfolio-params.js';
import { PortfolioService, type PortfolioResponse } from './portfolio.service.js';

@Controller('users')
export class PortfolioController {
  constructor(@Inject(PortfolioService) private readonly portfolioService: PortfolioService) {}

  @Get(':userId/portfolio')
  getPortfolio(@Param() params: PortfolioParams): Promise<PortfolioResponse> {
    return this.portfolioService.getPortfolio(params.userId);
  }
}
