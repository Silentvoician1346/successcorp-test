const {
  PrismaClient,
  MarketplaceType,
  UserRole,
  WmsStatus,
} = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@wms.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123456';
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
      name: 'Admin',
    },
    create: {
      email,
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
      name: 'Admin',
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  console.log(`Seeded admin user: ${user.email} (${user.role})`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`Default admin password: ${password}`);
  }

  const shopId = process.env.SEED_SHOP_ID || 'mock-shop-1';
  const marketplace = MarketplaceType.MOCK;

  const marketplaceConnection = await prisma.marketplaceConnection.upsert({
    where: {
      marketplace_shopId: {
        marketplace,
        shopId,
      },
    },
    update: {
      shopName: 'Mock Shop',
      accessToken: process.env.SEED_MARKETPLACE_ACCESS_TOKEN || 'mock-token',
      isActive: true,
    },
    create: {
      marketplace,
      shopId,
      shopName: 'Mock Shop',
      accessToken: process.env.SEED_MARKETPLACE_ACCESS_TOKEN || 'mock-token',
      refreshToken: 'mock-refresh-token',
      isActive: true,
    },
  });

  const seedOrders = [
    {
      orderSn: 'SHP001',
      marketplaceStatus: 'processing',
      shippingStatus: 'pending',
      wmsStatus: WmsStatus.READY_TO_PICK,
      trackingNumber: null,
      totalAmount: '449.48',
      marketplaceCreatedAt: new Date('2026-01-25T09:00:00.000Z'),
      items: [
        { sku: 'APP-001', quantity: 2, price: '199.99' },
        { sku: 'APP-002', quantity: 1, price: '49.50' },
      ],
    },
    {
      orderSn: 'SHP002',
      marketplaceStatus: 'paid',
      shippingStatus: 'pending',
      wmsStatus: WmsStatus.PACKED,
      trackingNumber: null,
      totalAmount: '129.00',
      marketplaceCreatedAt: new Date('2026-01-26T11:30:00.000Z'),
      items: [{ sku: 'APP-003', quantity: 3, price: '43.00' }],
    },
  ];

  const seededOrderSummary = [];

  for (const orderSeed of seedOrders) {
    const rawMarketplacePayload = {
      order_sn: orderSeed.orderSn,
      shop_id: shopId,
      status: orderSeed.marketplaceStatus,
      shipping_status: orderSeed.shippingStatus,
      tracking_number: orderSeed.trackingNumber,
      items: orderSeed.items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        price: Number(item.price),
      })),
      total_amount: Number(orderSeed.totalAmount),
      created_at: orderSeed.marketplaceCreatedAt.toISOString(),
    };

    const order = await prisma.order.upsert({
      where: {
        marketplace_shopId_orderSn: {
          marketplace,
          shopId,
          orderSn: orderSeed.orderSn,
        },
      },
      update: {
        marketplaceConnectionId: marketplaceConnection.id,
        marketplaceStatus: orderSeed.marketplaceStatus,
        shippingStatus: orderSeed.shippingStatus,
        wmsStatus: orderSeed.wmsStatus,
        trackingNumber: orderSeed.trackingNumber,
        totalAmount: orderSeed.totalAmount,
        rawMarketplacePayload,
        marketplaceCreatedAt: orderSeed.marketplaceCreatedAt,
        syncedAt: new Date(),
      },
      create: {
        orderSn: orderSeed.orderSn,
        shopId,
        marketplace,
        marketplaceConnectionId: marketplaceConnection.id,
        marketplaceStatus: orderSeed.marketplaceStatus,
        shippingStatus: orderSeed.shippingStatus,
        wmsStatus: orderSeed.wmsStatus,
        trackingNumber: orderSeed.trackingNumber,
        totalAmount: orderSeed.totalAmount,
        rawMarketplacePayload,
        marketplaceCreatedAt: orderSeed.marketplaceCreatedAt,
        syncedAt: new Date(),
      },
    });

    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderItem.createMany({
      data: orderSeed.items.map((item) => ({
        orderId: order.id,
        sku: item.sku,
        quantity: item.quantity,
        price: item.price,
      })),
    });

    seededOrderSummary.push({
      orderSn: order.orderSn,
      wmsStatus: orderSeed.wmsStatus,
      itemCount: orderSeed.items.length,
    });
  }

  console.log(`Seeded marketplace connection: ${marketplace}/${shopId}`);
  console.log(
    'Seeded orders:',
    seededOrderSummary
      .map(
        (order) =>
          `${order.orderSn} [${order.wmsStatus}] items=${order.itemCount}`,
      )
      .join(', '),
  );
  console.log(
    'Flow-ready order for API sequence: SHP001 (READY_TO_PICK -> PICKING -> PACKED -> SHIPPED)',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
