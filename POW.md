FULL-STACK DEVELOPER TECHNICAL TEST
Simple WMS (Warehouse Management System) with Marketplace Integration

Candidate Information
Name: ********\*\*********\_\_********\*\*********
Email: ********\*\*********\_********\*\*********
Submission Date: ****\*\*\*\*****\_\_\_\_****\*\*\*\*****

1. Background
   You are tasked with building a simple Warehouse Management System (WMS) that integrates with a Marketplace Mock API provided by us.
   The Marketplace API simulates real-world platforms such as Shopee / Lazada, including:
   OAuth authentication with signed requests
   Token expiration & refresh
   Protected endpoints
   Order & logistics lifecycle
   Webhook callbacks
   Rate limits and random failures
   Your WMS must consume and synchronize marketplace order data, while managing internal warehouse operations.

2. Required Tech Stack
   The project will be built using the following technologies:
   Backend
   Language: Golang/Node Js
   Framework: Fiber - GO/ Express /Nest Js
   Database: PostgreSQL
   ORM / Query Builder: Bun- Uptrace/ Prisma / TypeOrm
   Frontend
   UI Library: React.js
   CSS Framework: TailwindCSS
   Client State: Zustand (Preferable)
   Server Data: Tanstack Query (Preferable)
   Notes
   Backend and frontend should be separated clearly.
   Marketplace credentials must remain on the backend only
   Internal API authentication must be implemented server-side.

2.1 Tech Stack Compliance Check (verified on 2026-03-12)
[x] Backend language: Node.js (TypeScript) (`be-wsm/package.json`)
[x] Backend framework: NestJS (`be-wsm/package.json`, `be-wsm/src/app.module.ts`)
[x] Database: PostgreSQL (`be-wsm/prisma/schema.prisma`)
[x] ORM / Query Builder: Prisma (`be-wsm/package.json`, `be-wsm/prisma/schema.prisma`)
[x] Frontend UI library: React.js (`fe-wsm/package.json`)
[x] CSS framework: TailwindCSS (`fe-wsm/package.json`)
[ ] Client state: Zustand (preferable) - not found in dependencies/usage
[x] Server data: Tanstack Query (`fe-wsm/package.json`, `fe-wsm/components/providers/query-provider.tsx`)
[x] Backend/frontend separation: clear app split (`be-wsm/` and `fe-wsm/`)
[x] Marketplace credentials kept backend-side (`be-wsm/src/orders/services/marketplace.service.ts`; no FE secret usage)
[x] Internal API auth implemented server-side (`be-wsm/src/orders/orders.controller.ts` with `JwtAuthGuard`)

3. What This Test Evaluates
   We want to assess your ability to:
   Design a clean, scalable database
   Understand and follow technical documentation
   Integrate with a third-party API
   Build secure backend APIs
   Build a working system from scratch
   Reason about state management & data ownership

4. Minimal UI / View Requirements
   You may develop a web interface. The link is attached below:
   Technical Test – Figma
   The web interface should include the following features:
   Login Form
   Order list
   Order detail view
   Order statuses (Marketplace and WMS)
   Allowed actions based on the current order state
   \*The design similarity and frontend architecture of the implementation will be evaluated.

5. System Scope
   ✅ You are expected to build:
   A simple WMS backend
   Order lifecycle handling (pick → pack → ship)
   Marketplace API integration
   Minimal UI
   Secure internal APIs
   ❌ You are NOT expected to build:
   A marketplace
   Payment systems
   Complex frontend UI
   Multi-warehouse routing logic

6. Core Concepts
   6.1 Marketplace vs WMS

6.2 WMS Order Lifecycle
READY_TO_PICK → PICKING → PACKED → SHIPPED

This lifecycle is internal only and must not overwrite marketplace status.

7. Database Design Requirements
   You must design your own schema.
   Minimum Required Tables
   Orders
   order_sn
   shop_id
   marketplace_status
   shipping_status
   wms_status
   tracking_number
   total_amount
   raw_marketplace_payload
   created_at
   updated_at
   Order Items
   order_id
   sku
   quantity
   price
   Your schema design and normalization choices will be evaluated.

7.1 Database Compliance Check (verified on 2026-03-12)
[x] Orders table exists as `Order` model (`be-wsm/prisma/schema.prisma`)
[x] `order_sn` -> `orderSn`
[x] `shop_id` -> `shopId`
[x] `marketplace_status` -> `marketplaceStatus`
[x] `shipping_status` -> `shippingStatus`
[x] `wms_status` -> `wmsStatus`
[x] `tracking_number` -> `trackingNumber`
[x] `total_amount` -> `totalAmount`
[x] `raw_marketplace_payload` -> `rawMarketplacePayload`
[x] `created_at` -> `createdAt`
[x] `updated_at` -> `updatedAt`
[x] Order Items table exists as `OrderItem` model (`be-wsm/prisma/schema.prisma`)
[x] `order_id` -> `orderId`
[x] `sku` -> `sku`
[x] `quantity` -> `quantity`
[x] `price` -> `price`

7.2 What "Normalization" Means
Normalization means structuring database tables so each fact is stored in one proper place, reducing duplication and update inconsistencies.
In practical terms (this project):
`Order` stores order-level data (header/status/amount/payload).
`OrderItem` stores line-level data (SKU/qty/price) and links to order via `orderId`.
`MarketplaceConnection` stores marketplace token/connection data separately from orders.
`WebhookEvent` stores webhook event records separately for idempotency and audit.
This is a normalized design because repeating data is separated by entity and related with keys, which makes updates safer and queries clearer.

8. Internal WMS APIs
   These APIs are owned by the WMS, not the marketplace. All endpoints must be authenticated.

8.1 GET /orders
User Story
As a warehouse operator, I want to see all orders and their current state, so I know what to process next.
Requirements
Return all stored orders
Allow filtering by wms_status
Sort by updated_at descending
Response Example
{
"orders": [
{
"order_sn": "SHP001",
"wms_status": "PACKED",
"marketplace_status": "shipping",
"shipping_status": "shipped",
"tracking_number": "TRK-xxxx",
"updated_at": "2026-01-25T10:00:00Z"
}
]
}

8.2 GET /orders/:order_sn
User Story
As warehouse staff, I want to view full order details, so I can process the order correctly.
Requirements
Return full order detail
Return 404 if order does not exist

8.3 POST /orders/:order_sn/pick
User Story
As a picker, I want to mark an order as being picked.
Rules
Allowed only when:
wms_status = READY_TO_PICK
Transition to:
wms_status = PICKING

8.4 POST /orders/:order_sn/pack
User Story
As a packer, I want to mark an order as packed.
Rules
Allowed only when:
wms_status = PICKING
Transition to:
wms_status = PACKED

8.5 POST /orders/:order_sn/ship (CRITICAL)
User Story
As a warehouse admin, I want to ship an order and synchronize it with the marketplace.

IMPORTANT RULE
⚠️ Tracking numbers are generated by the Marketplace API — not the WMS.

Required Flow
Validate:
wms_status = PACKED
Call marketplace API:
POST /logistic/ship
Receive response
Persist:
tracking_number
shipping_status
Update:
wms_status = SHIPPED

Marketplace Response Example
{
"message": "Order shipped",
"data": {
"order_sn": "SHP001",
"shipping_status": "shipped",
"tracking_no": "TRK-b1fa0d41-b9ce-42b8-b170-60c02479a346"
}
}

WMS Response Example
{
"order_sn": "SHP001",
"wms_status": "SHIPPED",
"shipping_status": "shipped",
"tracking_number": "TRK-b1fa0d41-b9ce-42b8-b170-60c02479a346"
}
❌ Generating your own tracking number is considered incorrect behavior.

8.6 Internal API Compliance Check (verified on 2026-03-12)
[x] All `/orders` endpoints are authenticated server-side via `JwtAuthGuard` (`be-wsm/src/orders/orders.controller.ts`).
[~] `GET /orders` supports `wms_status` filtering and `updated_at` sorting descending by default; current implementation is paginated (default `page_size=10`) instead of returning all records in one response (`be-wsm/src/orders/orders.service.ts`, `be-wsm/src/orders/dto/get-orders.query.dto.ts`).
[x] `GET /orders/:order_sn` returns full detail with items and throws 404 when order is not found (`be-wsm/src/orders/orders.service.ts`).
[x] `POST /orders/:order_sn/pick` only allows `READY_TO_PICK -> PICKING` (`be-wsm/src/orders/orders.service.ts`).
[x] `POST /orders/:order_sn/pack` only allows `PICKING -> PACKED` (`be-wsm/src/orders/orders.service.ts`).
[x] `POST /orders/:order_sn/ship` validates `PACKED`, calls marketplace `/logistic/ship`, persists `tracking_number` and `shipping_status`, then updates `wms_status=SHIPPED` (`be-wsm/src/orders/orders.service.ts`, `be-wsm/src/orders/services/marketplace.service.ts`).
[x] Tracking number is sourced from marketplace response (`tracking_no` / `tracking_number`), not generated locally (`be-wsm/src/orders/orders.service.ts`).

9. Marketplace Integration Requirements
   You must integrate with the provided Marketplace Mock API, including:
   OAuth authorization
   Signed requests
   Token refresh
   Handling:
   401 Unauthorized
   429 Rate limit
   Random 500 failures
   Marketplace credentials must never be exposed to frontend

9.1 Marketplace Integration Compliance Check (verified on 2026-03-12)
[x] Integrated with marketplace mock API endpoints (`/oauth/authorize`, `/oauth/token`, `/order/list`, `/order/detail`, `/logistic/ship`) in `be-wsm/src/orders/services/marketplace.service.ts`.
[x] OAuth authorization flow implemented (authorize -> token exchange) in `bootstrapMarketplaceConnection`.
[x] Signed requests implemented via HMAC SHA256 `sign` for OAuth/token and protected order/logistic calls (`/order/list`, `/order/detail`, `/logistic/ship`).
[x] Token refresh implemented (`refreshMarketplaceAccessToken`) and persisted to DB.
[x] 401 handling implemented with refresh/bootstrap fallback for list/detail/ship calls.
[x] 429 handling includes dedicated retry/backoff strategy (supports `Retry-After` when provided).
[x] Random 500 handling includes transient retry/backoff strategy (5xx retries with exponential backoff + jitter).
[x] Marketplace credentials remain backend-side (`ConfigService` + backend env usage); frontend API routes proxy only to internal backend API.

10. Webhook Handling
    Implement webhook endpoints:
    POST /webhook/order-status
    POST /webhook/shipping-status
    Requirements
    Update local order records
    Handle duplicate webhook events safely
    Webhooks are public; internal APIs are not

11. Marketplace Payload Reference
    Order Detail (Sample)
    {
    "order_sn": "SHP001",
    "shop_id": "shopee-123",
    "status": "shipping",
    "shipping_status": "shipped",
    "tracking_number": "TRK-b1fa0d41-b9ce-42b8-b170-60c02479a346",
    "items": [
    { "sku": "APP-001", "quantity": 2, "price": 199.99 },
    { "sku": "APP-002", "quantity": 1, "price": 49.5 }
    ],
    "total_amount": 449.48,
    "created_at": "2026-01-25T09:00:00Z"
    }
    Order List (Sample)
    Marketplace returns mixed states intentionally:
    processing
    paid
    shipping
    delivered
    cancelled
    Your WMS must handle all states safely.

12. Security Expectations
    Authenticate all internal APIs
    Validate state transitions
    Prevent invalid actions
    Store marketplace tokens securely (server-side only)

13. Submission Requirements
    Please submit:
    Source code (GitHub repo or ZIP)
    README explaining:
    Architecture
    Database design
    Order lifecycle
    Marketplace integration
    Error handling
    Evidence of working flow:
    Logs, screenshots, or CLI output

14. Time Expectation
    Suggested time: 2 - 3 Days
    Partial completion is acceptable if documented clearly

15. Final Notes
    This test reflects real-world integration work.We value:
    Clear reasoning
    Correct responsibility boundaries
    Secure, maintainable code
    Explain why you made your design decisions.Good luck 🚀
