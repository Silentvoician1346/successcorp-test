# SuccessCorp WMS Technical Test

This repository contains a simple Warehouse Management System (WMS) that integrates with a mock marketplace API.

It is built as a monorepo:

- `be-wsm`: Backend API (NestJS + Prisma + PostgreSQL)
- `fe-wsm`: Frontend web app (Next.js + React + Tailwind + Zustand)

---

## Quick Start

### IMPORTANT

Please find env files for frontend and backend in zip submission files,
and task-submission.pdf for proviced-images report.

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose (recommended for local PostgreSQL)

### 1) Install dependencies

From repository root:

```bash
pnpm install
```

### 2) Configure environment variables

- `be-wsm/.env` and `fe-wsm/.env.local` is already provided in zip file submission.

### 3) Start PostgreSQL (Docker)

From repository root:

```bash
pnpm run db:up
pnpm run db:ps
```

Default DB values from `be-wsm/docker-compose.yml`:

- host: `localhost`
- port: `5432`
- database: `wms_db`
- user: `postgres`
- password: `password`

### 4) Run migrations and seed

```bash
pnpm --filter be-wsm run prisma:generate
pnpm --filter be-wsm exec prisma migrate deploy
pnpm --filter be-wsm run prisma:seed
```

Default seeded user:

- email: `admin@wms.local`
- password: `password`

### 5) Run apps

From repo root, use separated terminals

terminal 1

```bash
pnpm run dev:be
```

terminal 2

```bash
pnpm run dev:fe
```

why: I prefer separated terminal for easier logs

## Architecture

### High-level design

The system is split into clear responsibility boundaries:

1. `fe-wsm` (presentation + BFF routes)
2. `be-wsm` (domain logic + integrations + persistence)
3. PostgreSQL (source of truth)
4. External marketplace API (third-party integration)

### Frontend architecture (`fe-wsm`)

- Next.js App Router for pages and route handlers.
- React Query for server state (orders list/detail, sync, actions).
  - **note:** server-side prefetch and caching strategy are not implemented yet.
- Zustand (persisted) for lightweight client state (`email` display in header).
  - **note:** No direction for Zustand usage, I used it for `email` display instead of storing access token
- Route handlers under `app/api/*` act as a backend-for-frontend proxy:
  - Read auth cookie
  - Forward requests to `be-wsm`
  - **note:** Using this flow will minimize access token exposure to the browser

### Backend architecture (`be-wsm`)

Backend is organized by modules:

- `AuthModule`
  - login endpoint
  - JWT issuance + strategy
- `OrdersModule`
  - internal WMS APIs
  - WMS state transitions
  - marketplace sync and shipping orchestration
- `WebhookModule`
  - marketplace webhook ingestion
  - idempotent event processing
- `PrismaModule`
  - database access

Global points:

- request validation via `ValidationPipe`
- global rate limiting via `@nestjs/throttler`
- JWT guard on internal order APIs

---

## Database Design

Schema is implemented in `be-wsm/prisma/schema.prisma`.

### Core models

- `User`
  - internal authentication and role
- `MarketplaceConnection`
  - token lifecycle and per-shop marketplace connection state
  - **note:** since our WMS is connected to trusted third-party, we can keep one marketplace credentials in db, the use case is when there multiple users using WMS, they can use the same valid credentials from db and avoid having the credential sent into the frontend.
- `Order`
  - order-level state and payload snapshot
- `OrderItem`
  - line items (1:N with orders)
- `WebhookEvent`
  - deduplication/audit record for webhook delivery
  - **note:** for tracing and audit logs purpose

### Minimum required table coverage

Requirement mapping:

- Orders:
  - `order_sn` -> `orderSn`
  - `shop_id` -> `shopId`
  - `marketplace_status` -> `marketplaceStatus`
  - `shipping_status` -> `shippingStatus`
  - `wms_status` -> `wmsStatus`
  - `tracking_number` -> `trackingNumber`
  - `total_amount` -> `totalAmount`
  - `raw_marketplace_payload` -> `rawMarketplacePayload`
  - `created_at` -> `createdAt`
  - `updated_at` -> `updatedAt`
- Order Items:
  - `order_id` -> `orderId`
  - `sku`
  - `quantity`
  - `price`

### Normalization choices

- Order header and line items are split (`Order` vs `OrderItem`) to avoid repeated item arrays in the main order row.
- Marketplace connection/token state is separate from order rows (`MarketplaceConnection`) to avoid duplicating auth metadata.
- Webhook ingestion history is separate (`WebhookEvent`) so duplicate delivery is handled safely.

### Index and constraints rationale

- Unique key on `(marketplace, shopId, orderSn)` prevents duplicate business orders.
- Indexes on status and update timestamps support operational list filtering.
- Unique `eventKey` on webhook events enables idempotency.

---

## Order Lifecycle

Internal WMS state machine:

### Login

Login:
`input credentials -> next-api call WMS login endpoint -> login success -> zustand saves email -> redirect to dashboard`

Login Form also support:

- error handling for invalid email input, invalid credentials, and hidden password

### Dashboard

Order Table has features:

- filtering through "Marketplace Status", "Shipping Status", and "WMS Status"
- sorting by "Update At"
- pagination with react query instead of fetching all data at once

`READY_TO_PICK -> PICKING -> PACKED -> SHIPPED`

- **note:** This section will be better explained with images in task-submission.pdf

### Transition rules

- `POST /orders/:order_sn/pick`
  - allowed only from `READY_TO_PICK`
  - transitions to `PICKING`
- `POST /orders/:order_sn/pack`
  - allowed only from `PICKING`
  - transitions to `PACKED`
- `POST /orders/:order_sn/ship`
  - allowed only from `PACKED`
  - calls marketplace ship API
  - persists returned tracking number and shipping status
  - transitions to `SHIPPED`

### Important boundary

Marketplace Status and WMS Status on order table are intentionally distinct:

- marketplace status reflects external platform state
- WMS status reflects internal warehouse execution state

Why: this prevents internal workflow from incorrectly overwriting external truth.

---

## Marketplace Integration

Implemented in `OrdersService` + `MarketplaceService`.

### Supported integration flows

- OAuth authorize and token exchange
- signed requests (HMAC SHA256 `sign`)
- token refresh
- order list synchronization
- order detail synchronization
- ship action synchronization (`/logistic/ship`)

### Auth and token handling strategy

- Resolve active connection from DB (`MarketplaceConnection`).
- Reuse valid access token when possible.
- Refresh when access token is expired and refresh token is valid.
- Re-bootstrap OAuth as fallback if needed.

Why: this makes integration resilient to token expiry and reduces manual reconnect operations.

### Failure and retry strategy

- Dedicated retry/backoff for transient failures:
  - `429` and `5xx`
  - exponential backoff + jitter
  - honors `Retry-After` when present
- `401` triggers refresh/bootstrap fallback logic

Why: transient network/provider instability is expected in real integrations.

---

## Error Handling

### API input validation

- DTO + class-validator on query/body contracts.
- Global `ValidationPipe` with:
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
  - `transform: true`

### Domain and state errors

- Invalid transition -> `BadRequestException`
- Missing entity -> `NotFoundException`
- Invalid upstream response shape -> `BadGatewayException`

### Upstream integration errors

- Marketplace errors are normalized into gateway-style messages with status context.

### Webhook safety

- Payload fingerprint (`sha256`) builds deterministic `eventKey`.
- Unique `eventKey` constraint + safe create handling prevents duplicate processing.
- Webhook endpoints:
  - `POST /webhook/order-status`
  - `POST /webhook/shipping-status`
  - **note:** since webhook needs to be online public, i only develop them without testing, here is how they supposed to work:
- Order status flow:
  - Validate payload, normalize `order_sn`/`status`, then create idempotency key.
  - Insert webhook event first; if duplicate key, skip processing safely.
  - If order exists and status changed, update `orders.marketplace_status` + `synced_at`.
- Shipping status flow (concise):
  - Accept `shipping_state` (or fallback `status`) and optional `tracking_number`/`tracking_no`.
  - Insert webhook event first; if duplicate key, skip processing safely.
  - If order exists, update `orders.shipping_status`, optional `tracking_number`, and `synced_at`.
- Code references:
  - `be-wsm/src/webhook/webhook.controller.ts`
  - `be-wsm/src/webhook/webhook.service.ts`
  - `be-wsm/prisma/schema.prisma` (`WebhookEvent.eventKey` unique)

Why: duplicate webhook delivery is normal behavior in real external systems.

---

## Security and Responsibility Boundaries

- Marketplace credentials are server-side only (backend env/config).
- Internal WMS APIs are JWT-protected.
- Frontend interacts with backend through controlled route handlers.
- Access token is stored in `httpOnly` cookies for browser flows.
- Rate limiting protects backend from burst and abuse patterns.

Why: these boundaries reduce accidental secret exposure and keep trust zones explicit.

---

## Helpful Commands

```bash
# start/stop dockerized postgres
pnpm run db:up
pnpm run db:ps
pnpm run db:logs
pnpm run db:down

# run both apps
pnpm run dev

# backend checks
pnpm --filter be-wsm run build
pnpm --filter be-wsm run test
pnpm --filter be-wsm run lint

# frontend checks
pnpm --filter fe-wsm run build
pnpm --filter fe-wsm run lint
```
