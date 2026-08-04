import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  // 🔹 Habilitar CORS
  // CORS_ORIGINS: lista separada por comas con los orígenes permitidos
  // (ej. "https://paldex.corszas.com"). Si no está definida se permite todo,
  // que es lo cómodo en desarrollo pero NO lo que quieres en producción.
  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins?.length ? corsOrigins : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Authorization',
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('paldex-api')
    .setDescription(
      'Contrato de la API de paldex — generado desde los controllers y DTOs reales, siempre sincronizado con el código.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDocument, {
    jsonDocumentUrl: 'api-docs/json',
  });

  // '0.0.0.0' es obligatorio dentro de un contenedor: si se escucha solo en
  // localhost, el proxy de Coolify no puede alcanzar la app.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
