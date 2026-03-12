import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type SyncOrderItem = {
  sku: string;
  quantity: number;
  price: number;
};

export type SyncOrderRecord = {
  orderSn: string;
  shopId: string;
  marketplaceStatus: string;
  shippingStatus: string | null;
  trackingNumber: string | null;
  totalAmount: number;
  marketplaceCreatedAt: Date | null;
  items: SyncOrderItem[];
  rawMarketplacePayload: Prisma.JsonObject;
};

@Injectable()
export class OrderNormalizerService {
  // Converts raw marketplace payload into a validated SyncOrderRecord.
  normalizeMarketplaceOrderRecord(payload: unknown): SyncOrderRecord | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const orderSn = this.normalizeRequiredString(record.order_sn);
    const shopId = this.normalizeRequiredString(record.shop_id);
    if (!orderSn || !shopId) {
      return null;
    }

    const marketplaceStatus =
      this.normalizeRequiredString(record.status) ?? 'unknown';
    const shippingStatus = this.normalizeOptionalString(record.shipping_status);
    const trackingNumber =
      this.normalizeOptionalString(record.tracking_no) ??
      this.normalizeOptionalString(record.tracking_number);
    const totalAmount = this.normalizeNumber(record.total_amount);
    if (totalAmount === null) {
      return null;
    }
    const marketplaceCreatedAt = this.normalizeDate(record.created_at);
    const items = this.normalizeMarketplaceOrderItems(record.items);

    return {
      orderSn,
      shopId,
      marketplaceStatus,
      shippingStatus,
      trackingNumber,
      totalAmount,
      marketplaceCreatedAt,
      items,
      rawMarketplacePayload: payload as Prisma.JsonObject,
    };
  }

  // Normalizes and filters raw items array into typed order item records.
  private normalizeMarketplaceOrderItems(
    itemsPayload: unknown,
  ): SyncOrderItem[] {
    if (!Array.isArray(itemsPayload)) {
      return [];
    }

    const result: SyncOrderItem[] = [];
    for (const itemPayload of itemsPayload) {
      if (!itemPayload || typeof itemPayload !== 'object') {
        continue;
      }

      const item = itemPayload as Record<string, unknown>;
      const sku = this.normalizeRequiredString(item.sku);
      const quantityRaw = this.normalizeNumber(item.quantity);
      const priceRaw = this.normalizeNumber(item.price);
      if (!sku || quantityRaw === null || priceRaw === null) {
        continue;
      }

      const quantity = Math.floor(quantityRaw);
      if (quantity <= 0) {
        continue;
      }

      result.push({
        sku,
        quantity,
        price: priceRaw,
      });
    }

    return result;
  }

  // Returns trimmed string when required string field is valid.
  private normalizeRequiredString(value: unknown) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  }

  // Returns trimmed string or null for optional string field.
  private normalizeOptionalString(value: unknown) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  }

  // Parses numeric fields from number or numeric string input.
  private normalizeNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  // Parses ISO-like date strings into Date, returns null for invalid values.
  private normalizeDate(value: unknown) {
    if (typeof value !== 'string') {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date;
  }
}
