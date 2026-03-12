import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerModule,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ThrottlerBehindProxyGuard } from './rate-limit/throttler-behind-proxy.guard';
import { WebhookModule } from './webhook/webhook.module';

function toPositiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createThrottlerModule(options: ThrottlerModuleOptions): DynamicModule {
  const factory = ThrottlerModule as unknown as {
    forRoot: (throttlerOptions: ThrottlerModuleOptions) => DynamicModule;
  };

  return factory.forRoot(options);
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    createThrottlerModule({
      throttlers: [
        {
          ttl: toPositiveInt(process.env.RATE_LIMIT_TTL_MS, 60_000),
          limit: toPositiveInt(process.env.RATE_LIMIT_LIMIT, 120),
          blockDuration: toPositiveInt(process.env.RATE_LIMIT_BLOCK_MS, 30_000),
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    OrdersModule,
    WebhookModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
})
export class AppModule {}
