import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ClientIp, CurrentUser, CurrentWorkspace, Public, RequirePermission } from '../common/decorators';
import type { AppRequest, AuthUser, WorkspaceContext } from '../common/request-context';
import { checkoutSchema } from '../shared';
import { BillingService } from './billing.service';

class CheckoutDto extends createZodDto(checkoutSchema) {}
class MockSessionDto extends createZodDto(z.object({ session: z.string().min(10).max(2000) })) {}
class MockPortalActionDto extends createZodDto(
  z.object({
    session: z.string().min(10).max(2000),
    action: z.enum(['change_plan', 'cancel', 'fail_payment']),
    plan: z.enum(['PRO', 'BUSINESS']).optional(),
  }),
) {}

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  @RequirePermission('billing.manage')
  @ApiOperation({ summary: 'Start a checkout to upgrade the workspace (Stripe Checkout or the mock page)' })
  checkout(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Body() body: CheckoutDto,
    @ClientIp() ip: string | null,
  ) {
    return this.billing.checkout(ws, user, body.plan, ip);
  }

  @Post('portal')
  @HttpCode(200)
  @RequirePermission('billing.manage')
  @ApiOperation({ summary: 'Open the customer portal to change plan, cancel or update payment' })
  portal(@CurrentWorkspace() ws: WorkspaceContext) {
    return this.billing.portal(ws);
  }

  @Get('status')
  @RequirePermission('billing.read')
  status(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser) {
    return this.billing.status(ws, user.id);
  }

  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Billing provider webhook (signature verified against the raw body)' })
  webhook(@Req() req: AppRequest & { rawBody?: Buffer }) {
    return this.billing.handleWebhook(req.rawBody, req.headers);
  }

  // ---------- mock provider (keyless demo) ----------
  @Post('mock/session')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  mockSession(@Body() body: MockSessionDto) {
    return this.billing.describeMockSession(body.session);
  }

  @Post('mock/checkout/complete')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  completeMockCheckout(@CurrentUser() user: AuthUser, @Body() body: MockSessionDto) {
    return this.billing.completeMockCheckout(user, body.session);
  }

  @Post('mock/portal/action')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  mockPortalAction(@CurrentUser() user: AuthUser, @Body() body: MockPortalActionDto) {
    return this.billing.mockPortalAction(user, body.session, body.action, body.plan);
  }
}
