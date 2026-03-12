import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { OrderStatusWebhookDto } from './dto/order-status-webhook.dto';
import { ShippingStatusWebhookDto } from './dto/shipping-status-webhook.dto';
import { WebhookService } from './webhook.service';

@Controller('webhook')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  }),
)
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('order-status')
  async handleOrderStatus(@Body() payload: OrderStatusWebhookDto) {
    console.log('[webhook][order-status] received payload:', payload);
    try {
      const result =
        await this.webhookService.handleOrderStatusWebhook(payload);
      console.log('[webhook][order-status] response:', result);
      return result;
    } catch (error) {
      console.error('[webhook][order-status] failed:', error);
      throw error;
    }
  }

  @Post('shipping-status')
  async handleShippingStatus(@Body() payload: ShippingStatusWebhookDto) {
    console.log('[webhook][shipping-status] received payload:', payload);
    try {
      const result =
        await this.webhookService.handleShippingStatusWebhook(payload);
      console.log('[webhook][shipping-status] response:', result);
      return result;
    } catch (error) {
      console.error('[webhook][shipping-status] failed:', error);
      throw error;
    }
  }
}
