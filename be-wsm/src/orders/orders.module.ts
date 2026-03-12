import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { MarketplaceService } from './services/marketplace.service';
import { OrderNormalizerService } from './services/order-normalizer.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, MarketplaceService, OrderNormalizerService],
})
export class OrdersModule {}
