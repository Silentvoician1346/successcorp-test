import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplaceConnection, MarketplaceType, Order } from '@prisma/client';
import axios from 'axios';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

type MarketplaceShipApiResponse = {
  message?: string;
  data?: {
    order_sn?: string;
    shipping_status?: string;
    tracking_no?: string;
    tracking_number?: string;
  };
};

type MarketplaceOrderListApiResponse = {
  message?: string;
  data?: unknown;
};

type MarketplaceOrderDetailApiResponse = {
  message?: string;
  data?: unknown;
};

type MarketplaceAuthorizeApiResponse = {
  message?: string;
  data?: {
    code?: string;
    shop_id?: string;
    state?: string;
  };
};

type MarketplaceTokenApiResponse = {
  message?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };
};

export type MarketplaceTokenConnection = Pick<
  MarketplaceConnection,
  | 'id'
  | 'marketplace'
  | 'shopId'
  | 'isActive'
  | 'accessToken'
  | 'refreshToken'
  | 'accessTokenExpiresAt'
  | 'refreshTokenExpiresAt'
  | 'tokenType'
  | 'scope'
>;

export type MarketplaceShipResult = NonNullable<
  MarketplaceShipApiResponse['data']
>;

// Runtime guard for array payloads from external APIs.
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// Runtime guard for non-null object payloads from external APIs.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Injectable()
export class MarketplaceService {
  // Injects DB access and config for marketplace integration.
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // Fetches order list payload from marketplace using valid auth context.
  async fetchOrderList() {
    const baseUrl = this.getMarketplaceBaseUrl();
    const endpoint = `${baseUrl}/order/list`;

    const { accessToken, connection } =
      await this.resolveMarketplaceAuthContext(baseUrl);

    const orders = await this.callMarketplaceOrderList(
      endpoint,
      baseUrl,
      accessToken,
      connection,
    );

    return {
      orders,
      connection,
    };
  }

  // Fetches a single order detail payload from marketplace by order number.
  async fetchOrderDetail(orderSn: string) {
    const baseUrl = this.getMarketplaceBaseUrl();
    const endpoint = `${baseUrl}/order/detail?order_sn=${encodeURIComponent(orderSn)}`;

    const { accessToken, connection } =
      await this.resolveMarketplaceAuthContext(baseUrl);
    const payload = await this.callMarketplaceOrderDetail(
      endpoint,
      baseUrl,
      accessToken,
      connection,
    );

    return {
      payload,
      connection,
    };
  }

  // Ships an order through marketplace logistic endpoint.
  async shipOrder(order: Order): Promise<MarketplaceShipResult> {
    return this.callMarketplaceShip(order);
  }

  // Maps shop id patterns to a MarketplaceType enum.
  inferMarketplaceType(shopId: string): MarketplaceType {
    const normalizedShopId = shopId.toLowerCase();
    if (normalizedShopId.includes('shopee')) {
      return MarketplaceType.SHOPEE;
    }
    if (normalizedShopId.includes('lazada')) {
      return MarketplaceType.LAZADA;
    }
    return MarketplaceType.MOCK;
  }

  // Resolves active marketplace connection and returns a usable access token.
  private async resolveMarketplaceAuthContext(baseUrl: string) {
    let connection = await this.prisma.marketplaceConnection.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
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

    if (!connection) {
      connection = await this.bootstrapMarketplaceConnection(baseUrl);
    }

    const accessToken = await this.getMarketplaceAccessToken(
      connection,
      baseUrl,
    );
    return {
      accessToken,
      connection,
    };
  }

  // Calls order list endpoint with retry flow on token expiration.
  private async callMarketplaceOrderList(
    endpoint: string,
    baseUrl: string,
    accessToken: string,
    connection: MarketplaceTokenConnection,
  ) {
    try {
      return await this.requestMarketplaceOrderList(endpoint, accessToken);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401) {
          if (connection.refreshToken) {
            const refreshedToken = await this.refreshMarketplaceAccessToken(
              connection,
              baseUrl,
            );
            return this.requestMarketplaceOrderList(endpoint, refreshedToken);
          }

          const bootstrapped = await this.bootstrapMarketplaceConnection(
            baseUrl,
            {
              shopId: connection.shopId,
              marketplace: connection.marketplace,
            },
          );
          const bootstrappedAccessToken =
            bootstrapped.accessToken?.trim() ?? '';
          if (!bootstrappedAccessToken) {
            throw new InternalServerErrorException(
              'Marketplace OAuth bootstrap did not return a usable access token',
            );
          }
          return this.requestMarketplaceOrderList(
            endpoint,
            bootstrappedAccessToken,
          );
        }
      }

      throw this.toMarketplaceError(error, endpoint, 'order list');
    }
  }

  // Calls order detail endpoint with retry flow on token expiration.
  private async callMarketplaceOrderDetail(
    endpoint: string,
    baseUrl: string,
    accessToken: string,
    connection: MarketplaceTokenConnection,
  ) {
    try {
      return await this.requestMarketplaceOrderDetail(endpoint, accessToken);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401) {
          if (connection.refreshToken) {
            const refreshedToken = await this.refreshMarketplaceAccessToken(
              connection,
              baseUrl,
            );
            return this.requestMarketplaceOrderDetail(endpoint, refreshedToken);
          }

          const bootstrapped = await this.bootstrapMarketplaceConnection(
            baseUrl,
            {
              shopId: connection.shopId,
              marketplace: connection.marketplace,
            },
          );
          const bootstrappedAccessToken =
            bootstrapped.accessToken?.trim() ?? '';
          if (!bootstrappedAccessToken) {
            throw new InternalServerErrorException(
              'Marketplace OAuth bootstrap did not return a usable access token',
            );
          }
          return this.requestMarketplaceOrderDetail(
            endpoint,
            bootstrappedAccessToken,
          );
        }
      }

      throw this.toMarketplaceError(error, endpoint, 'order detail');
    }
  }

  // Performs raw HTTP request for marketplace order list and validates response shape.
  private async requestMarketplaceOrderList(
    endpoint: string,
    accessToken: string,
  ): Promise<Record<string, unknown>[]> {
    const response = await axios.get<MarketplaceOrderListApiResponse>(
      endpoint,
      {
        headers: this.buildMarketplaceHeaders(accessToken),
        timeout: 10000,
      },
    );

    const responseData = response.data?.data;
    if (!isUnknownArray(responseData)) {
      throw new BadGatewayException(
        'Marketplace order list response missing data array',
      );
    }

    const records = responseData.filter(isRecord);
    if (records.length !== responseData.length) {
      throw new BadGatewayException(
        'Marketplace order list response contains non-object entries',
      );
    }

    return records;
  }

  // Performs raw HTTP request for marketplace order detail and validates response shape.
  private async requestMarketplaceOrderDetail(
    endpoint: string,
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    const response = await axios.get<MarketplaceOrderDetailApiResponse>(
      endpoint,
      {
        headers: this.buildMarketplaceHeaders(accessToken),
        timeout: 10000,
      },
    );

    const payload = response.data?.data;
    if (!isRecord(payload)) {
      throw new BadGatewayException(
        'Marketplace order detail response missing data object',
      );
    }

    return payload;
  }

  // Performs OAuth bootstrap and upserts marketplace connection/token in DB.
  private async bootstrapMarketplaceConnection(
    baseUrl: string,
    options?: {
      shopId?: string;
      marketplace?: MarketplaceType;
    },
  ) {
    const { partnerId, partnerKey } = this.getMarketplacePartnerCredentials();
    const shopId =
      options?.shopId ??
      (this.configService.get<string>('MARKETPLACE_SHOP_ID')?.trim() ||
        'shopee-123');
    const state =
      this.configService.get<string>('MARKETPLACE_OAUTH_STATE')?.trim() ||
      'wsm';
    const redirectUri =
      this.configService.get<string>('MARKETPLACE_REDIRECT_URI')?.trim() ||
      'https://example.com/callback';

    const authorizeApiPath = '/oauth/authorize';
    const authorizeTimestamp = Math.floor(Date.now() / 1000);
    const authorizeBase = `${partnerId}${authorizeApiPath}${authorizeTimestamp}${shopId}`;
    const authorizeSign = this.createMarketplaceSign(partnerKey, authorizeBase);
    const authorizeEndpoint =
      `${baseUrl}${authorizeApiPath}` +
      `?shop_id=${encodeURIComponent(shopId)}` +
      `&state=${encodeURIComponent(state)}` +
      `&partner_id=${encodeURIComponent(partnerId)}` +
      `&timestamp=${authorizeTimestamp}` +
      `&sign=${authorizeSign}` +
      `&redirect=${encodeURIComponent(redirectUri)}`;

    let authCode = '';
    let resolvedShopId = shopId;
    try {
      const authorizeResponse =
        await axios.get<MarketplaceAuthorizeApiResponse>(authorizeEndpoint, {
          headers: { Accept: 'application/json' },
          timeout: 10000,
        });

      authCode = authorizeResponse.data?.data?.code?.trim() ?? '';
      const responseShopId =
        authorizeResponse.data?.data?.shop_id?.trim() ?? '';
      if (responseShopId) {
        resolvedShopId = responseShopId;
      }
    } catch (error) {
      throw this.toMarketplaceError(error, authorizeEndpoint, 'authorize');
    }

    if (!authCode) {
      throw new BadGatewayException(
        'Marketplace authorize response missing code',
      );
    }

    const tokenApiPath = '/oauth/token';
    const tokenTimestamp = Math.floor(Date.now() / 1000);
    const tokenBase = `${partnerId}${tokenApiPath}${tokenTimestamp}${authCode}`;
    const tokenSign = this.createMarketplaceSign(partnerKey, tokenBase);
    const tokenEndpoint =
      `${baseUrl}${tokenApiPath}` +
      `?partner_id=${encodeURIComponent(partnerId)}` +
      `&timestamp=${tokenTimestamp}` +
      `&sign=${tokenSign}`;

    let tokenData: MarketplaceTokenApiResponse['data'] | undefined;
    try {
      const tokenResponse = await axios.post<MarketplaceTokenApiResponse>(
        tokenEndpoint,
        {
          grant_type: 'authorization_code',
          code: authCode,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        },
      );
      tokenData = tokenResponse.data?.data;
    } catch (error) {
      throw this.toMarketplaceError(error, tokenEndpoint, 'token exchange');
    }

    const nextAccessToken = tokenData?.access_token?.trim();
    if (!nextAccessToken) {
      throw new BadGatewayException(
        'Marketplace token response missing access_token',
      );
    }

    const nextRefreshToken = tokenData?.refresh_token?.trim() || null;
    const expiresInSeconds =
      typeof tokenData?.expires_in === 'number' ? tokenData.expires_in : null;
    const accessTokenExpiresAt = expiresInSeconds
      ? new Date(Date.now() + expiresInSeconds * 1000)
      : null;
    const marketplace =
      options?.marketplace ?? this.inferMarketplaceType(resolvedShopId);

    const connection = await this.prisma.marketplaceConnection.upsert({
      where: {
        marketplace_shopId: {
          marketplace,
          shopId: resolvedShopId,
        },
      },
      update: {
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        accessTokenExpiresAt,
        tokenType: tokenData?.token_type ?? undefined,
        scope: tokenData?.scope ?? undefined,
        isActive: true,
      },
      create: {
        marketplace,
        shopId: resolvedShopId,
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        accessTokenExpiresAt,
        tokenType: tokenData?.token_type ?? null,
        scope: tokenData?.scope ?? null,
        isActive: true,
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

    return connection;
  }

  // Reads partner credentials from environment with fallback variable names.
  private getMarketplacePartnerCredentials() {
    const partnerId =
      this.configService.get<string>('MARKETPLACE_PARTNER_ID') ??
      this.configService.get<string>('MARKETPLACE_CLIENT_ID');
    const partnerKey =
      this.configService.get<string>('MARKETPLACE_PARTNER_KEY') ??
      this.configService.get<string>('MARKETPLACE_CLIENT_SECRET');

    if (!partnerId || !partnerKey) {
      throw new InternalServerErrorException(
        'MARKETPLACE_PARTNER_ID/MARKETPLACE_PARTNER_KEY (or MARKETPLACE_CLIENT_ID/SECRET) are required',
      );
    }

    return { partnerId, partnerKey };
  }

  // Builds HMAC SHA256 signature required by marketplace API.
  private createMarketplaceSign(partnerKey: string, base: string) {
    return createHmac('sha256', partnerKey).update(base).digest('hex');
  }

  // Calls marketplace ship endpoint with token refresh/bootstrap fallback.
  private async callMarketplaceShip(order: Order) {
    const baseUrl = this.getMarketplaceBaseUrl();
    const endpoint = `${baseUrl}/logistic/ship`;

    let connection = await this.prisma.marketplaceConnection.findUnique({
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

    if (!connection) {
      connection = await this.bootstrapMarketplaceConnection(baseUrl, {
        shopId: order.shopId,
        marketplace: order.marketplace,
      });
    }

    const accessToken = await this.getMarketplaceAccessToken(
      connection,
      baseUrl,
    );
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
        if (status === 401) {
          if (connection.refreshToken) {
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

          const bootstrapped = await this.bootstrapMarketplaceConnection(
            baseUrl,
            {
              shopId: order.shopId,
              marketplace: order.marketplace,
            },
          );
          const bootstrappedAccessToken =
            bootstrapped.accessToken?.trim() ?? '';
          if (!bootstrappedAccessToken) {
            throw new InternalServerErrorException(
              'Marketplace OAuth bootstrap did not return a usable access token',
            );
          }
          return this.requestMarketplaceShip(
            endpoint,
            order.orderSn,
            channelId,
            bootstrappedAccessToken,
          );
        }
      }

      throw this.toMarketplaceError(error, endpoint, 'ship');
    }
  }

  // Performs raw HTTP request to ship an order and validates ship response body.
  private async requestMarketplaceShip(
    endpoint: string,
    orderSn: string,
    channelId: string,
    accessToken: string,
  ): Promise<MarketplaceShipResult> {
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
      throw new BadGatewayException(
        'Marketplace ship response missing data payload',
      );
    }

    return response.data.data;
  }

  // Builds common outbound headers (auth + optional client credentials).
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

  // Returns a valid access token, refreshing or bootstrapping when needed.
  private async getMarketplaceAccessToken(
    connection: MarketplaceTokenConnection,
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

    const bootstrapped = await this.bootstrapMarketplaceConnection(baseUrl, {
      shopId: connection.shopId,
      marketplace: connection.marketplace,
    });
    const bootstrappedAccessToken = bootstrapped.accessToken?.trim() ?? '';
    if (!bootstrappedAccessToken) {
      throw new InternalServerErrorException(
        'Marketplace OAuth bootstrap did not return a usable access token',
      );
    }

    return bootstrappedAccessToken;
  }

  // Refreshes access token using refresh token and persists new values.
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

    const { partnerId, partnerKey } = this.getMarketplacePartnerCredentials();

    const apiPath = '/oauth/token';
    const timestamp = Math.floor(Date.now() / 1000);
    const base = `${partnerId}${apiPath}${timestamp}${refreshToken}`;
    const sign = this.createMarketplaceSign(partnerKey, base);
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

  // Normalizes axios errors into gateway-friendly HTTP exceptions.
  private toMarketplaceError(
    error: unknown,
    endpoint: string,
    operation: string,
  ) {
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
    const body: unknown = error.response.data;
    const detail =
      typeof body === 'string'
        ? body
        : isRecord(body) && typeof body.message === 'string'
          ? body.message
          : JSON.stringify(body ?? {});

    return new BadGatewayException(
      `Marketplace ${operation} failed (${status}${statusText ? ` ${statusText}` : ''}): ${detail}`,
    );
  }

  // Resolves and normalizes marketplace base URL from env config.
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
