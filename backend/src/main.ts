import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  // Trust the first reverse proxy hop (Render/Vercel/nginx/etc.).
  // Required for req.ip and rate limiting to key on the real client IP
  // via X-Forwarded-For. Must run before helmet and any IP-based middleware.
  app.set('trust proxy', 1);

  const baseUrl = configService.get<string>('BASE_URL', 'http://localhost:3000');
  // Dev-only: allow Vite/WebSocket dev origins inside CSP connect-src.
  // Production CSP MUST NOT contain any localhost entries.
  const connectSrc = [
    "'self'",
    baseUrl,
    ...(process.env.NODE_ENV !== 'production'
      ? ['ws://localhost:*', 'wss://localhost:*']
      : []),
  ];
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc,
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      // crossOriginEmbedderPolicy must stay false — pdfmake uses blob: URLs
      // which COEP 'require-corp' blocks, causing PDF generation to fail
      crossOriginEmbedderPolicy: false,
    }),
  );

  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
  const allowedOrigins = frontendUrl.split(',').map(o => o.trim());
  // In development, also allow the Vite preview port
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:5180', 'http://localhost:5175');
  }
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // NestJS scans global filters in reverse-registration order, matching
  // the most-recently-registered first. The specific ThrottlerExceptionFilter
  // must come LAST so it wins over the @Catch() catch-all HttpExceptionFilter
  // for ThrottlerException — otherwise 429s fall through to the generic
  // INTERNAL_ERROR envelope and lose the Retry-After contract.
  app.useGlobalFilters(new HttpExceptionFilter(), new ThrottlerExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SIGN Platform API')
    .setDescription('AI-powered construction contract management platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 3000);

  const logger = new Logger('Bootstrap');
  logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`Port: ${process.env.PORT || 3000}`);
  logger.log('✅ All environment variables validated successfully');

  await app.listen(port);
  console.log(`SIGN Platform API running on port ${port}`);
}
bootstrap();
