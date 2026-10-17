import { Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { BillingController } from './billing.controller';
import { BillingProvider } from './billing.provider';
import { BillingService } from './billing.service';
import { MockBillingProvider } from './mock-billing.provider';
import { PlanLimitsService } from './plan-limits.service';
import { StripeBillingProvider } from './stripe-billing.provider';

@Module({
  controllers: [BillingController],
  providers: [
    PlanLimitsService,
    BillingService,
    {
      provide: BillingProvider,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.billingProvider === 'stripe' ? new StripeBillingProvider(env) : new MockBillingProvider(env),
    },
  ],
  exports: [PlanLimitsService, BillingService],
})
export class BillingModule {}
