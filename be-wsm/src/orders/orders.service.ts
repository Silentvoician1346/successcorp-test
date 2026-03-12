import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Order, OrderItem, Prisma, WmsStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MarketplaceService,
  MarketplaceTokenConnection,
} from './services/marketplace.service';
import {
  OrderNormalizerService,
  SyncOrderRecord,
} from './services/order-normalizer.service';

type OrderWithItems = Order & { items: OrderItem[] };

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplaceService: MarketplaceService,
    private readonly orderNormalizerService: OrderNormalizerService,
  ) {}

  async getOrders(
    wmsStatuses?: WmsStatus[],
    marketplaceStatuses?: string[],
    shippingStatuses?: string[],
    page?: number,
    pageSize?: number,
    updatedAtOrder?: Prisma.SortOrder,
  ) {
    const safePage = page && page > 0 ? page : 1;
    const safePageSize = pageSize && pageSize > 0 ? pageSize : 10;
    const safeUpdatedAtOrder = updatedAtOrder ?? 'desc';
    const safeWmsStatuses =
      wmsStatuses?.filter((status): status is WmsStatus => Boolean(status)) ??
      [];
    const safeMarketplaceStatuses =
      marketplaceStatuses?.map((status) => status.trim()).filter(Boolean) ?? [];
    const safeShippingStatuses =
      shippingStatuses?.map((status) => status.trim()).filter(Boolean) ?? [];

    const where: Prisma.OrderWhereInput = {};
    if (safeWmsStatuses.length > 0) {
      where.wmsStatus = { in: safeWmsStatuses };
    }
    if (safeMarketplaceStatuses.length > 0) {
      where.marketplaceStatus = { in: safeMarketplaceStatuses };
    }
    if (safeShippingStatuses.length > 0) {
      where.shippingStatus = { in: safeShippingStatuses };
    }

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({
        where,
      }),
      this.prisma.order.findMany({
        where,
        orderBy: { updatedAt: safeUpdatedAtOrder },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / safePageSize));

    return {
      pagination: {
        page: safePage,
        page_size: safePageSize,
        total,
        total_pages: totalPages,
      },
      orders: orders.map((order) => ({
        order_sn: order.orderSn,
        wms_status: order.wmsStatus,
        marketplace_status: order.marketplaceStatus,
        shipping_status: order.shippingStatus,
        tracking_number: order.trackingNumber,
        updated_at: order.updatedAt.toISOString(),
      })),
    };
  }

  async getOrderDetail(orderSn: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderSn },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderSn} not found`);
    }

    return this.toOrderDetailResponse(order);
  }

  async pickOrder(orderSn: string) {
    const updatedOrder = await this.transitionWmsStatus(
      orderSn,
      WmsStatus.READY_TO_PICK,
      WmsStatus.PICKING,
    );

    return this.toWmsActionResponse(updatedOrder);
  }

  async packOrder(orderSn: string) {
    const updatedOrder = await this.transitionWmsStatus(
      orderSn,
      WmsStatus.PICKING,
      WmsStatus.PACKED,
    );

    return this.toWmsActionResponse(updatedOrder);
  }

  async shipOrder(orderSn: string) {
    const order = await this.requireOrderByOrderSn(orderSn);

    if (order.wmsStatus !== WmsStatus.PACKED) {
      throw new BadRequestException(
        `Cannot ship order ${orderSn}: current wms_status is ${order.wmsStatus}, expected PACKED`,
      );
    }

    const shipResult = await this.marketplaceService.shipOrder(order);
    const trackingNumber = shipResult.tracking_no ?? shipResult.tracking_number;
    if (!trackingNumber) {
      throw new BadGatewayException(
        'Marketplace ship response missing tracking number',
      );
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        wmsStatus: WmsStatus.SHIPPED,
        shippingStatus: shipResult.shipping_status ?? order.shippingStatus,
        trackingNumber,
        syncedAt: new Date(),
      },
    });

    return {
      order_sn: updatedOrder.orderSn,
      wms_status: updatedOrder.wmsStatus,
      shipping_status: updatedOrder.shippingStatus,
      tracking_number: updatedOrder.trackingNumber,
    };
  }

  async syncOrdersFromMarketplace() {
    const { orders: marketplaceOrders, connection } =
      await this.marketplaceService.fetchOrderList();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const payload of marketplaceOrders) {
      const normalized =
        this.orderNormalizerService.normalizeMarketplaceOrderRecord(payload);
      if (!normalized) {
        skipped += 1;
        continue;
      }

      const syncResult = await this.upsertMarketplaceOrderRecord(
        normalized,
        connection,
      );
      if (syncResult === 'updated') {
        updated += 1;
      } else {
        created += 1;
      }
    }

    return {
      message: 'Orders synchronized from marketplace',
      summary: {
        fetched: marketplaceOrders.length,
        created,
        updated,
        skipped,
      },
    };
  }

  async syncOrderFromMarketplace(orderSn: string) {
    const normalizedOrderSn = orderSn.trim();
    if (!normalizedOrderSn) {
      throw new BadRequestException('order_sn is required');
    }

    const { payload, connection } =
      await this.marketplaceService.fetchOrderDetail(normalizedOrderSn);
    const normalized =
      this.orderNormalizerService.normalizeMarketplaceOrderRecord(payload);
    if (!normalized) {
      throw new BadGatewayException(
        'Marketplace order detail response has invalid payload',
      );
    }

    const syncResult = await this.upsertMarketplaceOrderRecord(
      normalized,
      connection,
    );

    return {
      message: 'Order synchronized from marketplace',
      data: {
        order_sn: normalized.orderSn,
        result: syncResult,
      },
    };
  }

  private async upsertMarketplaceOrderRecord(
    normalized: SyncOrderRecord,
    preferredConnection?: MarketplaceTokenConnection | null,
  ) {
    const activeConnection = await this.prisma.marketplaceConnection.findFirst({
      where: {
        shopId: normalized.shopId,
        isActive: true,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        marketplace: true,
        shopId: true,
      },
    });

    const preferred =
      preferredConnection && preferredConnection.shopId === normalized.shopId
        ? preferredConnection
        : null;
    const marketplace =
      activeConnection?.marketplace ??
      preferred?.marketplace ??
      this.marketplaceService.inferMarketplaceType(normalized.shopId);
    const marketplaceConnectionId =
      activeConnection?.id ?? preferred?.id ?? null;

    const existingOrder = await this.prisma.order.findUnique({
      where: {
        marketplace_shopId_orderSn: {
          marketplace,
          shopId: normalized.shopId,
          orderSn: normalized.orderSn,
        },
      },
      select: {
        id: true,
      },
    });

    const orderData = {
      marketplaceConnectionId,
      marketplaceStatus: normalized.marketplaceStatus,
      shippingStatus: normalized.shippingStatus,
      trackingNumber: normalized.trackingNumber,
      totalAmount: normalized.totalAmount,
      rawMarketplacePayload: normalized.rawMarketplacePayload,
      marketplaceCreatedAt: normalized.marketplaceCreatedAt ?? undefined,
      syncedAt: new Date(),
    };

    const order = existingOrder
      ? await this.prisma.order.update({
          where: { id: existingOrder.id },
          data: orderData,
        })
      : await this.prisma.order.create({
          data: {
            orderSn: normalized.orderSn,
            shopId: normalized.shopId,
            marketplace,
            ...orderData,
          },
        });

    await this.prisma.orderItem.deleteMany({
      where: { orderId: order.id },
    });

    if (normalized.items.length > 0) {
      await this.prisma.orderItem.createMany({
        data: normalized.items.map((item) => ({
          orderId: order.id,
          sku: item.sku,
          quantity: item.quantity,
          price: item.price,
        })),
      });
    }

    return existingOrder ? 'updated' : 'created';
  }

  private async transitionWmsStatus(
    orderSn: string,
    expectedStatus: WmsStatus,
    nextStatus: WmsStatus,
  ) {
    const order = await this.requireOrderByOrderSn(orderSn);

    if (order.wmsStatus !== expectedStatus) {
      throw new BadRequestException(
        `Cannot transition order ${orderSn} to ${nextStatus}: current wms_status is ${order.wmsStatus}, expected ${expectedStatus}`,
      );
    }

    return this.prisma.order.update({
      where: { id: order.id },
      data: { wmsStatus: nextStatus },
    });
  }

  private async requireOrderByOrderSn(orderSn: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderSn },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderSn} not found`);
    }

    return order;
  }

  private toWmsActionResponse(order: Order) {
    return {
      order_sn: order.orderSn,
      wms_status: order.wmsStatus,
      marketplace_status: order.marketplaceStatus,
      shipping_status: order.shippingStatus,
      tracking_number: order.trackingNumber,
      updated_at: order.updatedAt.toISOString(),
    };
  }

  private toOrderDetailResponse(order: OrderWithItems) {
    return {
      order: {
        order_sn: order.orderSn,
        shop_id: order.shopId,
        marketplace: order.marketplace,
        marketplace_status: order.marketplaceStatus,
        shipping_status: order.shippingStatus,
        wms_status: order.wmsStatus,
        tracking_number: order.trackingNumber,
        total_amount: Number(order.totalAmount),
        raw_marketplace_payload: order.rawMarketplacePayload,
        marketplace_created_at:
          order.marketplaceCreatedAt?.toISOString() ?? null,
        synced_at: order.syncedAt?.toISOString() ?? null,
        created_at: order.createdAt.toISOString(),
        updated_at: order.updatedAt.toISOString(),
        items: order.items.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          price: Number(item.price),
        })),
      },
    };
  }
}
