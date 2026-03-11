import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplaceConnection, Order, OrderItem, WmsStatus } from '@prisma/client';
import axios from 'axios';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

type OrderWithItems = Order & { items: OrderItem[] };

type MarketplaceShipApiResponse = {
  message?: string;
  data?: {
    order_sn?: string;
    shipping_status?: string;
    tracking_no?: string;
    tracking_number?: string;
  };
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getOrders(wmsStatus?: WmsStatus) {
    const orders = await this.prisma.order.findMany({
      where: wmsStatus ? { wmsStatus } : undefined,
      orderBy: { updatedAt: 'desc' },
    });

    return {
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

    const shipResult = await this.callMarketplaceShip(order);
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

  private async callMarketplaceShip(order: Order) {
    const baseUrl = this.getMarketplaceBaseUrl();
    const endpoint = `${baseUrl}/logistic/ship`;

    const connection = await this.prisma.marketplaceConnection.findUnique({
      where: {
        marketplace_shopId: {
          marketplace: order.marketplace,
          shopId: order.shopId,
        },
      },
      select: {
        id: true,
        marketplace: true,
        shopId: true,
        isActive: true,
        accessToken: true,
        refreshToken: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
        tokenType: true,
        scope: true,
      },
    });

    const channelId =
      this.configService.get<string>('MARKETPLACE_CHANNEL_ID') ?? 'JNE';
    const envAccessToken =
      this.configService.get<string>('MARKETPLACE_ACCESS_TOKEN')?.trim() ?? '';

    let accessToken = envAccessToken;
    if (!accessToken) {
      if (!connection) {
        throw new InternalServerErrorException(
          `Marketplace connection not found for ${order.marketplace}/${order.shopId}`,
        );
      }
      accessToken = await this.getMarketplaceAccessToken(connection, baseUrl);
    }

    try {
      return await this.requestMarketplaceShip(
        endpoint,
        order.orderSn,
        channelId,
        accessToken,
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 && !envAccessToken && connection?.refreshToken) {
          const refreshedToken = await this.refreshMarketplaceAccessToken(
            connection,
            baseUrl,
          );
          return this.requestMarketplaceShip(
            endpoint,
            order.orderSn,
            channelId,
            refreshedToken,
          );
        }
      }

      throw this.toMarketplaceError(error, endpoint, 'ship');
    }
  }

  private async requestMarketplaceShip(
    endpoint: string,
    orderSn: string,
    channelId: string,
    accessToken: string,
  ) {
    const response = await axios.post<MarketplaceShipApiResponse>(
      endpoint,
      {
        order_sn: orderSn,
        channel_id: channelId,
      },
      {
        headers: this.buildMarketplaceHeaders(accessToken),
        timeout: 10000,
      },
    );

    if (!response.data?.data) {
      throw new BadGatewayException('Marketplace ship response missing data payload');
    }

    return response.data.data;
  }

  private buildMarketplaceHeaders(accessToken: string) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    const clientId = this.configService.get<string>('MARKETPLACE_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'MARKETPLACE_CLIENT_SECRET',
    );
    if (clientId) {
      headers['x-client-id'] = clientId;
    }
    if (clientSecret) {
      headers['x-client-secret'] = clientSecret;
    }

    return headers;
  }

  private async getMarketplaceAccessToken(
    connection: Pick<
      MarketplaceConnection,
      | 'id'
      | 'isActive'
      | 'accessToken'
      | 'refreshToken'
      | 'accessTokenExpiresAt'
      | 'refreshTokenExpiresAt'
    >,
    baseUrl: string,
  ) {
    if (!connection.isActive) {
      throw new InternalServerErrorException(
        'Marketplace connection is inactive. Reconnect marketplace account.',
      );
    }

    const now = Date.now();
    const currentAccessToken = connection.accessToken?.trim() ?? '';
    const accessTokenExpiresAt = connection.accessTokenExpiresAt?.getTime();

    // Small safety window to avoid sending nearly-expired access tokens.
    const isAccessTokenUsable =
      currentAccessToken &&
      (!accessTokenExpiresAt || accessTokenExpiresAt - now > 30_000);
    if (isAccessTokenUsable) {
      return currentAccessToken;
    }

    const refreshToken = connection.refreshToken?.trim() ?? '';
    const refreshTokenExpiresAt = connection.refreshTokenExpiresAt?.getTime();
    const isRefreshTokenUsable =
      refreshToken &&
      (!refreshTokenExpiresAt || refreshTokenExpiresAt - now > 0);

    if (isRefreshTokenUsable) {
      return this.refreshMarketplaceAccessToken(connection, baseUrl);
    }

    if (currentAccessToken) {
      return currentAccessToken;
    }

    throw new InternalServerErrorException(
      'Marketplace access token is missing. Run marketplace OAuth connect flow first.',
    );
  }

  private async refreshMarketplaceAccessToken(
    connection: Pick<MarketplaceConnection, 'id' | 'refreshToken'>,
    baseUrl: string,
  ) {
    const refreshToken = connection.refreshToken?.trim() ?? '';
    if (!refreshToken) {
      throw new InternalServerErrorException(
        'Marketplace refresh token is missing. Reconnect marketplace account.',
      );
    }

    const partnerId =
      this.configService.get<string>('MARKETPLACE_PARTNER_ID') ??
      this.configService.get<string>('MARKETPLACE_CLIENT_ID');
    const partnerKey =
      this.configService.get<string>('MARKETPLACE_PARTNER_KEY') ??
      this.configService.get<string>('MARKETPLACE_CLIENT_SECRET');

    if (!partnerId || !partnerKey) {
      throw new InternalServerErrorException(
        'MARKETPLACE_PARTNER_ID/MARKETPLACE_PARTNER_KEY (or MARKETPLACE_CLIENT_ID/SECRET) are required for token refresh',
      );
    }

    const apiPath = '/oauth/token';
    const timestamp = Math.floor(Date.now() / 1000);
    const base = `${partnerId}${apiPath}${timestamp}${refreshToken}`;
    const sign = createHmac('sha256', partnerKey).update(base).digest('hex');
    const endpoint = `${baseUrl}${apiPath}?partner_id=${encodeURIComponent(partnerId)}&timestamp=${timestamp}&sign=${sign}`;

    try {
      const response = await axios.post<{
        data?: {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          token_type?: string;
          scope?: string;
        };
      }>(
        endpoint,
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );

      const tokenData = response.data?.data;
      const nextAccessToken = tokenData?.access_token?.trim();
      if (!nextAccessToken) {
        throw new BadGatewayException(
          'Marketplace refresh response missing access_token',
        );
      }

      const nextRefreshToken = tokenData?.refresh_token?.trim() || refreshToken;
      const expiresInSeconds =
        typeof tokenData?.expires_in === 'number' ? tokenData.expires_in : null;
      const accessTokenExpiresAt = expiresInSeconds
        ? new Date(Date.now() + expiresInSeconds * 1000)
        : null;

      await this.prisma.marketplaceConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: nextAccessToken,
          refreshToken: nextRefreshToken,
          accessTokenExpiresAt,
          tokenType: tokenData?.token_type ?? undefined,
          scope: tokenData?.scope ?? undefined,
        },
      });

      return nextAccessToken;
    } catch (error) {
      throw this.toMarketplaceError(error, endpoint, 'token refresh');
    }
  }

  private toMarketplaceError(error: unknown, endpoint: string, operation: string) {
    if (!axios.isAxiosError(error)) {
      return error;
    }

    if (!error.response) {
      return new BadGatewayException(
        `Marketplace ${operation} failed: no response from ${endpoint} (${error.code ?? 'UNKNOWN'}: ${error.message})`,
      );
    }

    const status = error.response.status;
    const statusText = error.response.statusText;
    const body = error.response.data;
    const detail =
      typeof body === 'string'
        ? body
        : typeof body === 'object' &&
            body !== null &&
            'message' in body &&
            typeof body.message === 'string'
          ? body.message
          : JSON.stringify(body ?? {});

    return new BadGatewayException(
      `Marketplace ${operation} failed (${status}${statusText ? ` ${statusText}` : ''}): ${detail}`,
    );
  }

  private getMarketplaceBaseUrl() {
    const rawUrl =
      this.configService.get<string>('MARKETPLACE_URL') ??
      this.configService.get<string>('MARKETPLACE_BASE_URL');

    if (!rawUrl) {
      throw new InternalServerErrorException(
        'MARKETPLACE_URL (or MARKETPLACE_BASE_URL) is not configured',
      );
    }

    const normalized = rawUrl.trim().replace(/\/+$/, '');
    if (!normalized) {
      throw new InternalServerErrorException(
        'MARKETPLACE_URL is empty after trimming',
      );
    }

    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }

    return `https://${normalized}`;
  }
}
