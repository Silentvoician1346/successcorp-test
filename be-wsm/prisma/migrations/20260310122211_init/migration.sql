-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "WmsStatus" AS ENUM ('READY_TO_PICK', 'PICKING', 'PACKED', 'SHIPPED');

-- CreateEnum
CREATE TYPE "MarketplaceType" AS ENUM ('SHOPEE', 'LAZADA', 'MOCK');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('ORDER_STATUS', 'SHIPPING_STATUS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "marketplace" "MarketplaceType" NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "tokenType" TEXT,
    "scope" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderSn" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "marketplace" "MarketplaceType" NOT NULL,
    "marketplaceConnectionId" TEXT,
    "marketplaceStatus" TEXT NOT NULL,
    "shippingStatus" TEXT,
    "wmsStatus" "WmsStatus" NOT NULL DEFAULT 'READY_TO_PICK',
    "trackingNumber" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "rawMarketplacePayload" JSONB NOT NULL,
    "marketplaceCreatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" "WebhookEventType" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "orderId" TEXT,
    "orderSn" TEXT,
    "shopId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "MarketplaceConnection_isActive_idx" ON "MarketplaceConnection"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_marketplace_shopId_key" ON "MarketplaceConnection"("marketplace", "shopId");

-- CreateIndex
CREATE INDEX "Order_wmsStatus_updatedAt_idx" ON "Order"("wmsStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "Order_marketplaceStatus_idx" ON "Order"("marketplaceStatus");

-- CreateIndex
CREATE INDEX "Order_shippingStatus_idx" ON "Order"("shippingStatus");

-- CreateIndex
CREATE INDEX "Order_shopId_idx" ON "Order"("shopId");

-- CreateIndex
CREATE INDEX "Order_updatedAt_idx" ON "Order"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_marketplace_shopId_orderSn_key" ON "Order"("marketplace", "shopId", "orderSn");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_sku_idx" ON "OrderItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventKey_key" ON "WebhookEvent"("eventKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventType_createdAt_idx" ON "WebhookEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_orderSn_shopId_idx" ON "WebhookEvent"("orderSn", "shopId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_marketplaceConnectionId_fkey" FOREIGN KEY ("marketplaceConnectionId") REFERENCES "MarketplaceConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
