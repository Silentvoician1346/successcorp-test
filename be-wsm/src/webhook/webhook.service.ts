import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, WebhookEventType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatusWebhookDto } from './dto/order-status-webhook.dto';
import { ShippingStatusWebhookDto } from './dto/shipping-status-webhook.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleOrderStatusWebhook(payload: OrderStatusWebhookDto) {
    const orderSn = payload.order_sn.trim();
    const status = payload.status.trim();
    const shopId = payload.shop_id?.trim() || null;
    const payloadJson = this.toJsonPayload(payload);
    const eventKey = this.buildEventKey(WebhookEventType.ORDER_STATUS, payloadJson);

    return this.prisma.$transaction(async (tx) => {
      const event = await this.createWebhookEventSafely(tx, {
        eventType: WebhookEventType.ORDER_STATUS,
        eventKey,
        orderSn,
        shopId,
        payload: payloadJson,
      });

      if (!event) {
        this.logger.warn(
          `Duplicate order-status webhook ignored (order_sn=${orderSn}, status=${status})`,
        );
        return {
          message: 'Duplicate webhook ignored',
          data: {
            order_sn: orderSn,
            status,
            duplicate: true,
          },
        };
      }

      const order = await tx.order.findFirst({
        where: {
          orderSn,
          ...(shopId ? { shopId } : {}),
        },
        select: {
          id: true,
          orderSn: true,
          shopId: true,
          marketplaceStatus: true,
        },
      });

      if (!order) {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            orderSn,
            shopId,
            processedAt: new Date(),
          },
        });

        this.logger.warn(
          `Order not found for order-status webhook (order_sn=${orderSn}, shop_id=${shopId ?? '-'})`,
        );
        return {
          message: 'Webhook received but order not found',
          data: {
            order_sn: orderSn,
            status,
            order_found: false,
          },
        };
      }

      if (order.marketplaceStatus === status) {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            orderId: order.id,
            orderSn: order.orderSn,
            shopId: order.shopId,
            processedAt: new Date(),
          },
        });

        this.logger.log(
          `Order status unchanged from webhook (order_sn=${order.orderSn}, status=${status})`,
        );
        return {
          message: 'Order status unchanged',
          data: {
            order_sn: order.orderSn,
            status,
            changed: false,
          },
        };
      }

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          marketplaceStatus: status,
          syncedAt: new Date(),
        },
        select: {
          id: true,
          orderSn: true,
          shopId: true,
          marketplaceStatus: true,
        },
      });

      await tx.webhookEvent.update({
        where: { id: event.id },
        data: {
          orderId: updatedOrder.id,
          orderSn: updatedOrder.orderSn,
          shopId: updatedOrder.shopId,
          processedAt: new Date(),
        },
      });

      this.logger.log(
        `Order status updated from webhook (order_sn=${updatedOrder.orderSn}, status=${updatedOrder.marketplaceStatus})`,
      );
      return {
        message: 'Order status updated',
        data: {
          order_sn: updatedOrder.orderSn,
          status: updatedOrder.marketplaceStatus,
        },
      };
    });
  }

  async handleShippingStatusWebhook(payload: ShippingStatusWebhookDto) {
    const orderSn = payload.order_sn.trim();
    const shippingState =
      payload.shipping_state?.trim() || payload.status?.trim() || '';
    const shopId = payload.shop_id?.trim() || null;

    if (!shippingState) {
      throw new BadRequestException(
        'shipping_state or status is required',
      );
    }

    const trackingNumber =
      payload.tracking_number?.trim() ||
      payload.tracking_no?.trim() ||
      null;

    const payloadJson = this.toJsonPayload(payload);
    const eventKey = this.buildEventKey(
      WebhookEventType.SHIPPING_STATUS,
      payloadJson,
    );

    return this.prisma.$transaction(async (tx) => {
      const event = await this.createWebhookEventSafely(tx, {
        eventType: WebhookEventType.SHIPPING_STATUS,
        eventKey,
        orderSn,
        shopId,
        payload: payloadJson,
      });

      if (!event) {
        this.logger.warn(
          `Duplicate shipping-status webhook ignored (order_sn=${orderSn}, shipping_state=${shippingState})`,
        );
        return {
          message: 'Duplicate webhook ignored',
          data: {
            order_sn: orderSn,
            shipping_state: shippingState,
            duplicate: true,
          },
        };
      }

      const order = await tx.order.findFirst({
        where: {
          orderSn,
          ...(shopId ? { shopId } : {}),
        },
        select: {
          id: true,
          orderSn: true,
          shopId: true,
          shippingStatus: true,
          trackingNumber: true,
        },
      });

      if (!order) {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            orderSn,
            shopId,
            processedAt: new Date(),
          },
        });

        this.logger.warn(
          `Order not found for shipping-status webhook (order_sn=${orderSn}, shop_id=${shopId ?? '-'})`,
        );
        return {
          message: 'Webhook received but order not found',
          data: {
            order_sn: orderSn,
            shipping_state: shippingState,
            order_found: false,
          },
        };
      }

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          shippingStatus: shippingState,
          ...(trackingNumber ? { trackingNumber } : {}),
          syncedAt: new Date(),
        },
        select: {
          id: true,
          orderSn: true,
          shopId: true,
          shippingStatus: true,
          trackingNumber: true,
        },
      });

      await tx.webhookEvent.update({
        where: { id: event.id },
        data: {
          orderId: updatedOrder.id,
          orderSn: updatedOrder.orderSn,
          shopId: updatedOrder.shopId,
          processedAt: new Date(),
        },
      });

      this.logger.log(
        `Shipping status updated from webhook (order_sn=${updatedOrder.orderSn}, shipping_status=${updatedOrder.shippingStatus})`,
      );
      return {
        message: 'Shipping status updated',
        data: {
          order_sn: updatedOrder.orderSn,
          shipping_state: updatedOrder.shippingStatus,
          tracking_number: updatedOrder.trackingNumber,
        },
      };
    });
  }

  private buildEventKey(
    eventType: WebhookEventType,
    payload: Prisma.InputJsonValue,
  ) {
    const fingerprint = JSON.stringify(payload);
    const digest = createHash('sha256').update(fingerprint).digest('hex');
    return `${eventType}:${digest}`;
  }

  private async createWebhookEventSafely(
    tx: Prisma.TransactionClient,
    args: {
      eventType: WebhookEventType;
      eventKey: string;
      orderSn: string;
      shopId: string | null;
      payload: Prisma.InputJsonValue;
    },
  ) {
    try {
      return await tx.webhookEvent.create({
        data: {
          eventType: args.eventType,
          eventKey: args.eventKey,
          orderSn: args.orderSn,
          shopId: args.shopId,
          payload: args.payload,
        },
        select: { id: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }

      throw error;
    }
  }

  private toJsonPayload(payload: unknown): Prisma.InputJsonValue {
    try {
      return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
    } catch {
      return { raw: String(payload) };
    }
  }
}
