import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    if (trustProxy.toLowerCase() === 'true') {
      app.set('trust proxy', 1);
    } else {
      const hops = Number.parseInt(trustProxy, 10);
      if (Number.isFinite(hops) && hops > 0) {
        app.set('trust proxy', hops);
      }
    }
  }

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
