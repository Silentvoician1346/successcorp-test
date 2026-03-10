Design principles

The schema should keep marketplace data and WMS state separate:

Marketplace owns: marketplace order status, shipping status, tracking number source, raw payload

WMS owns: internal processing lifecycle READY_TO_PICK -> PICKING -> PACKED -> SHIPPED

Backend owns: auth, webhook deduplication, token storage, state transitions

Because marketplace statuses may change or expand, I recommend:

Use enum for wms_status since it is fully controlled by your app

Use string for marketplace_status and shipping_status since they are external values

Recommended tables

1. users

For internal API authentication.

2. marketplace_connections

Stores OAuth credentials/tokens per shop/marketplace.

3. orders

Main order table.

4. order_items

Normalized order items.

5. webhook_events

For idempotency / duplicate webhook handling.

6. order_status_logs (recommended)

Audit trail for debugging and proof of lifecycle transitions.

Prisma schema
generator client {
provider = "prisma-client-js"
}

datasource db {
provider = "postgresql"
url = env("DATABASE_URL")
}

enum UserRole {
ADMIN
OPERATOR
PICKER
PACKER
}

enum WmsStatus {
READY_TO_PICK
PICKING
PACKED
SHIPPED
}

enum MarketplaceType {
SHOPEE
LAZADA
MOCK
}

enum WebhookEventType {
ORDER_STATUS
SHIPPING_STATUS
}

model User {
id String @id @default(uuid())
email String @unique
passwordHash String
name String?
role UserRole @default(OPERATOR)
isActive Boolean @default(true)
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt

statusLogs OrderStatusLog[] @relation("StatusLogActor")
}

model MarketplaceConnection {
id String @id @default(uuid())
marketplace MarketplaceType
shopId String
shopName String?
accessToken String
refreshToken String?
accessTokenExpiresAt DateTime?
refreshTokenExpiresAt DateTime?
tokenType String?
scope String?
isActive Boolean @default(true)
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt

orders Order[]

@@unique([marketplace, shopId])
@@index([isActive])
}

model Order {
id String @id @default(uuid())
orderSn String
shopId String
marketplace MarketplaceType
marketplaceConnectionId String?

marketplaceStatus String
shippingStatus String?
wmsStatus WmsStatus @default(READY_TO_PICK)

trackingNumber String?
totalAmount Decimal @db.Decimal(12, 2)

rawMarketplacePayload Json

marketplaceCreatedAt DateTime?
syncedAt DateTime?

createdAt DateTime @default(now())
updatedAt DateTime @updatedAt

marketplaceConnection MarketplaceConnection? @relation(fields: [marketplaceConnectionId], references: [id], onDelete: SetNull)
items OrderItem[]
webhookEvents WebhookEvent[]
statusLogs OrderStatusLog[]

@@unique([marketplace, shopId, orderSn])
@@index([wmsStatus, updatedAt(sort: Desc)])
@@index([marketplaceStatus])
@@index([shippingStatus])
@@index([shopId])
@@index([updatedAt(sort: Desc)])
}

model OrderItem {
id String @id @default(uuid())
orderId String
sku String
quantity Int
price Decimal @db.Decimal(12, 2)
createdAt DateTime @default(now())

order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)

@@index([orderId])
@@index([sku])
}

model WebhookEvent {
id String @id @default(uuid())
eventType WebhookEventType
eventKey String @unique
orderId String?
orderSn String?
shopId String?
payload Json
processedAt DateTime?
createdAt DateTime @default(now())

order Order? @relation(fields: [orderId], references: [id], onDelete: SetNull)

@@index([eventType, createdAt])
@@index([orderSn, shopId])
}

model OrderStatusLog {
id String @id @default(uuid())
orderId String
actorUserId String?
action String
fromWmsStatus WmsStatus?
toWmsStatus WmsStatus?
fromMarketplaceStatus String?
toMarketplaceStatus String?
fromShippingStatus String?
toShippingStatus String?
note String?
metadata Json?
createdAt DateTime @default(now())

order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
actor User? @relation("StatusLogActor", fields: [actorUserId], references: [id], onDelete: SetNull)

@@index([orderId, createdAt])
}
Why this schema works well
orders

This is the core table and includes all fields required by the test:

order_sn

shop_id

marketplace_status

shipping_status

wms_status

tracking_number

total_amount

raw_marketplace_payload

timestamps

Important choice

I used:

@@unique([marketplace, shopId, orderSn])

instead of making orderSn alone unique.

That is safer because in real integrations:

one order_sn may only be unique per shop/platform

future multi-shop support becomes easier

order_items

This keeps item data normalized and queryable.

You could technically store items only inside rawMarketplacePayload, but that would be worse because:

harder to render order detail

harder to query SKUs

less normalized

not good for evaluation

marketplace_connections

This is important for OAuth integration.

Store tokens server-side only, never in frontend state.
This table supports:

access token

refresh token

expiration time

per-shop connection

This matches the test’s requirement around OAuth, token refresh, and secure integration.

webhook_events

This is very important for:

duplicate webhook handling

idempotency

debugging replayed events

You can generate eventKey from something like:

marketplace event id, if provided

or a hash of {event_type}:{order_sn}:{status}:{timestamp}

Then ignore duplicates when eventKey already exists.

order_status_logs

Not strictly required, but strongly recommended.

This helps show:

who picked / packed / shipped

transition history

marketplace webhook changes

easier debugging for failed sync cases

For a technical test, this gives a strong impression.

Recommended backend rules

These should be enforced in NestJS service layer, not only the frontend.

Pick

Allowed only when:

order.wmsStatus === 'READY_TO_PICK'

Then update to:

PICKING
Pack

Allowed only when:

order.wmsStatus === 'PICKING'

Then update to:

PACKED
Ship

Allowed only when:

order.wmsStatus === 'PACKED'

Then:

call marketplace POST /logistic/ship

receive tracking_no and shipping_status

persist both

set wms_status = SHIPPED

Do not generate tracking number locally.

Suggested API response mapping

For your frontend with Zustand + TanStack Query, this schema maps cleanly to:

Order list

Query from orders only, maybe with selected fields:

orderSn

wmsStatus

marketplaceStatus

shippingStatus

trackingNumber

updatedAt

Order detail

Query orders + order_items + maybe order_status_logs

This is enough for:

order detail page

status chips

action buttons

history panel

Nice-to-have columns you may add

These are optional but useful:

On orders

lastSyncError String?

lastSyncedAt DateTime?

cancelledAt DateTime?

On marketplace_connections

webhookSecret String?

baseUrl String?

On webhook_events

isDuplicate Boolean @default(false)

errorMessage String?
