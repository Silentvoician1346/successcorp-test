import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetOrdersQueryDto } from './dto/get-orders.query.dto';
import { OrdersService } from './orders.service';

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  getOrders(@Query() query: GetOrdersQueryDto) {
    return this.ordersService.getOrders(query.wms_status);
  }

  @Get(':order_sn')
  getOrderDetail(@Param('order_sn') orderSn: string) {
    return this.ordersService.getOrderDetail(orderSn);
  }

  @Post('sync')
  syncOrders() {
    return this.ordersService.syncOrdersFromMarketplace();
  }

  @Post(':order_sn/pick')
  pickOrder(@Param('order_sn') orderSn: string) {
    return this.ordersService.pickOrder(orderSn);
  }

  @Post(':order_sn/pack')
  packOrder(@Param('order_sn') orderSn: string) {
    return this.ordersService.packOrder(orderSn);
  }

  @Post(':order_sn/ship')
  shipOrder(@Param('order_sn') orderSn: string) {
    return this.ordersService.shipOrder(orderSn);
  }
}
