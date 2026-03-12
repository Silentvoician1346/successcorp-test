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
  private readonly marketplaceRetryAttempts = 3;
  private readonly marketplaceRetryBaseDelayMs = 300;
  private readonly marketplaceRetryJitterMs = 200;

  // Injects DB access and config for marketplace integration.
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // Fetches order list payload from marketplace using valid auth context.
  async fetchOrderList() {
    const baseUrl = this.getMarketplaceBaseUrl();

    const { accessToken, connection } =
      await this.resolveMarketplaceAuthContext(baseUrl);

    const orders = await this.callMarketplaceOrderList(
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

    const { accessToken, connection } =
      await this.resolveMarketplaceAuthContext(baseUrl);
    const payload = await this.callMarketplaceOrderDetail(
      baseUrl,
      orderSn,
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
    const preferredShopId =
      this.configService.get<string>('MARKETPLACE_SHOP_ID')?.trim() || null;

    let connection = preferredShopId
      ? await this.prisma.marketplaceConnection.findFirst({
          where: { isActive: true, shopId: preferredShopId },
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
        })
      : null;

    if (!connection) {
      connection = await this.prisma.marketplaceConnection.findFirst({
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
    }

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
    baseUrl: string,
    accessToken: string,
    connection: MarketplaceTokenConnection,
  ) {
    const endpoint = `${baseUrl}/order/list`;
    try {
      return await this.requestMarketplaceOrderList(
        baseUrl,
        accessToken,
        connection.shopId,
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
            return this.requestMarketplaceOrderList(
              baseUrl,
              refreshedToken,
              connection.shopId,
            );
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
            baseUrl,
            bootstrappedAccessToken,
            bootstrapped.shopId,
          );
        }
      }

      throw this.toMarketplaceError(error, endpoint, 'order list');
    }
  }

  // Calls order detail endpoint with retry flow on token expiration.
  private async callMarketplaceOrderDetail(
    baseUrl: string,
    orderSn: string,
    accessToken: string,
    connection: MarketplaceTokenConnection,
  ) {
    const endpoint = `${baseUrl}/order/detail`;
    try {
      return await this.requestMarketplaceOrderDetail(
        baseUrl,
        orderSn,
        accessToken,
        connection.shopId,
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
            return this.requestMarketplaceOrderDetail(
              baseUrl,
              orderSn,
              refreshedToken,
              connection.shopId,
            );
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
            baseUrl,
            orderSn,
            bootstrappedAccessToken,
            bootstrapped.shopId,
          );
        }
      }

      throw this.toMarketplaceError(error, endpoint, 'order detail');
    }
  }

  // Performs raw HTTP request for marketplace order list and validates response shape.
  private async requestMarketplaceOrderList(
    baseUrl: string,
    accessToken: string,
    shopId: string,
  ): Promise<Record<string, unknown>[]> {
    const endpoint = this.buildSignedMarketplaceEndpoint(
      baseUrl,
      '/order/list',
      {
        accessToken,
        shopId,
      },
    );
    const response = await this.requestMarketplaceWithRetry(() =>
      axios.get<MarketplaceOrderListApiResponse>(endpoint, {
        headers: this.buildMarketplaceHeaders(accessToken),
        timeout: 10000,
      }),
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
    baseUrl: string,
    orderSn: string,
    accessToken: string,
    shopId: string,
  ): Promise<Record<string, unknown>> {
    const endpoint = this.buildSignedMarketplaceEndpoint(
      baseUrl,
      '/order/detail',
      {
        accessToken,
        shopId,
        query: { order_sn: orderSn },
      },
    );
    const response = await this.requestMarketplaceWithRetry(() =>
      axios.get<MarketplaceOrderDetailApiResponse>(endpoint, {
        headers: this.buildMarketplaceHeaders(accessToken),
        timeout: 10000,
      }),
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
      const authorizeResponse = await this.requestMarketplaceWithRetry(() =>
        axios.get<MarketplaceAuthorizeApiResponse>(authorizeEndpoint, {
          headers: { Accept: 'application/json' },
          timeout: 10000,
        }),
      );

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
      const tokenResponse = await this.requestMarketplaceWithRetry(() =>
        axios.post<MarketplaceTokenApiResponse>(
          tokenEndpoint,
          {
            grant_type: 'authorization_code',
            code: authCode,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
          },
        ),
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
        baseUrl,
        order.orderSn,
        channelId,
        accessToken,
        order.shopId,
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
              baseUrl,
              order.orderSn,
              channelId,
              refreshedToken,
              order.shopId,
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
            baseUrl,
            order.orderSn,
            channelId,
            bootstrappedAccessToken,
            order.shopId,
          );
        }
      }

      throw this.toMarketplaceError(error, endpoint, 'ship');
    }
  }

  // Performs raw HTTP request to ship an order and validates ship response body.
  private async requestMarketplaceShip(
    baseUrl: string,
    orderSn: string,
    channelId: string,
    accessToken: string,
    shopId: string,
  ): Promise<MarketplaceShipResult> {
    const endpoint = this.buildSignedMarketplaceEndpoint(
      baseUrl,
      '/logistic/ship',
      { accessToken, shopId },
    );
    const response = await this.requestMarketplaceWithRetry(() =>
      axios.post<MarketplaceShipApiResponse>(
        endpoint,
        {
          order_sn: orderSn,
          channel_id: channelId,
        },
        {
          headers: this.buildMarketplaceHeaders(accessToken),
          timeout: 10000,
        },
      ),
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
      const response = await this.requestMarketplaceWithRetry(() =>
        axios.post<{
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
        ),
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

  // Builds signed marketplace endpoint for protected resource calls.
  private buildSignedMarketplaceEndpoint(
    baseUrl: string,
    apiPath: string,
    options: {
      accessToken: string;
      shopId?: string;
      query?: Record<string, string>;
    },
  ) {
    const { partnerId, partnerKey } = this.getMarketplacePartnerCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const base =
      `${partnerId}${apiPath}${timestamp}${options.accessToken}` +
      (options.shopId ?? '');
    const sign = this.createMarketplaceSign(partnerKey, base);

    const url = new URL(`${baseUrl}${apiPath}`);
    url.searchParams.set('partner_id', partnerId);
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value.trim()) {
          url.searchParams.set(key, value);
        }
      }
    }

    return url.toString();
  }

  // Retries marketplace requests on rate limit and transient server errors.
  private async requestMarketplaceWithRetry<T>(request: () => Promise<T>) {
    let attempt = 1;

    while (true) {
      try {
        return await request();
      } catch (error) {
        if (!this.shouldRetryMarketplaceRequest(error, attempt)) {
          throw error;
        }

        const delayMs = this.getMarketplaceRetryDelayMs(error, attempt);
        await this.sleep(delayMs);
        attempt += 1;
      }
    }
  }

  private shouldRetryMarketplaceRequest(error: unknown, attempt: number) {
    if (attempt >= this.marketplaceRetryAttempts) {
      return false;
    }

    if (!axios.isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;
    if (status === undefined) {
      return true;
    }

    if (status === 429) {
      return true;
    }

    return status >= 500 && status < 600;
  }

  private getMarketplaceRetryDelayMs(error: unknown, attempt: number) {
    const retryAfterDelay = this.getRetryAfterDelayMs(error);
    if (retryAfterDelay !== null) {
      return retryAfterDelay;
    }

    const exponentialDelay =
      this.marketplaceRetryBaseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * this.marketplaceRetryJitterMs);
    return exponentialDelay + jitter;
  }

  private getRetryAfterDelayMs(error: unknown) {
    if (!axios.isAxiosError(error) || !error.response) {
      return null;
    }

    const rawRetryAfter = error.response.headers?.['retry-after'];
    const retryAfter = Array.isArray(rawRetryAfter)
      ? rawRetryAfter[0]
      : rawRetryAfter;
    if (typeof retryAfter !== 'string') {
      return null;
    }

    const retryAfterSeconds = Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return retryAfterSeconds * 1000;
    }

    const retryAfterDate = Date.parse(retryAfter);
    if (Number.isNaN(retryAfterDate)) {
      return null;
    }

    return Math.max(0, retryAfterDate - Date.now());
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
