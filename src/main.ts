import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Keep the raw request body for Razorpay webhook
  // signature verification.
  app.use(
    json({
      verify: (req: any, _res, buf) => {
        if (
          req.originalUrl.startsWith(
            '/payments/webhook',
          )
        ) {
          req.rawBody = Buffer.from(buf);
        }
      },
    }),
  );

  app.use(
    urlencoded({
      extended: true,
    }),
  );

  // Allow requests from the Next.js frontend
  app.enableCors({
    origin: 'http://13.204.134.137:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(3001);
}

bootstrap();
