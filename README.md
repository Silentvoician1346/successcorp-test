# SuccessCorp WMS Technical Test

## IMPORTANT

This file is guide to bootstart the application.
For mini-task completion report, please read task-submission.pdf on zip file
Only in zip file submission you will find:

- env files for frontend and backend
- task-submission.pdf

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 14+ (or compatible)
- Docker + Docker Compose (optional, recommended for local DB)

## 1) Install Dependencies

From repo root:

```bash
pnpm install
```

## 2) Configure Environment Variables

### Backend (`be-wsm/.env`)

File for env is provided within zip file submission

### Frontend (`fe-wsm/.env.local`)

File for env.local is provided within zip file submission

## 3) Prepare Database

### Option A: PostgreSQL via Docker (recommended)

Start Postgres container:

```bash
pnpm run db:up
pnpm run db:ps
```

Default Docker DB config from [`be-wsm/docker-compose.yml`]

### Option B: Local PostgreSQL

If not using Docker, create database manually:

```sql
CREATE DATABASE wms_db;
```

### Run migrations + seed

From repo root:

```bash
pnpm --filter be-wsm run prisma:generate
pnpm --filter be-wsm exec prisma migrate deploy
pnpm --filter be-wsm run prisma:seed
```

Seed defaults:

- Email: `admin@wms.local`
- Password: `password`

You can override with:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`

## 4) Run the Project (Development)

From repo root, use separated terminals

terminal 1

```bash
pnpm run dev:be
```

terminal 2

```bash
pnpm run dev:fe
```

## 5) Login and Main Flow

1. Open `http://localhost:3000/login`
2. Login with seeded credentials
3. Go to dashboard and sync/process orders

## Troubleshooting

- `ECONNREFUSED` to DB:
  - Ensure PostgreSQL is running
  - Verify `DATABASE_URL` host, port, user, password, db name
- `401 Unauthorized` on internal APIs:
  - Login first and use returned JWT/cookie flow through frontend
- Prisma migration issues:
  - Re-check DB permissions and existing schema
- If browser previously had a stale service worker:
  - Hard refresh once or unregister in browser devtools

## Notes

For mini-task completion report, please read task-submission.pdf on zip file
