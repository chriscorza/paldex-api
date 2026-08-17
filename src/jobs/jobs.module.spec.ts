import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { JobsModule } from './jobs.module';
import { ScheduledJobsService } from './scheduled-jobs.service';

/*
 * El spec del servicio corre con los tres servicios mockeados, así que no vería
 * que un módulo dejara de exportar el suyo —`ShopifyReconciliationService` era
 * interno a `ShopifyModule` hasta que estos crons lo necesitaron—. Esto arma el
 * módulo de verdad: si alguien quita ese export, falla aquí y no al arrancar en
 * producción.
 *
 * `JwtModule` va porque `ShopifyConnectionService` lo pide y en la app entera
 * lo publica `AuthModule` con `global: true`.
 */
it('JobsModule resuelve sus dependencias reales', async () => {
  const module = await Test.createTestingModule({
    imports: [JobsModule, JwtModule.register({ secret: 'test', global: true })],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

  expect(module.get(ScheduledJobsService)).toBeDefined();
});
