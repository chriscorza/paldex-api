import { Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesController, PermissionsController } from './roles.controller';
import { PrismaModule } from 'src/prisma.module';
import { PermissionsModule } from 'src/permissions/permissions.module';

@Module({
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
  imports: [PrismaModule, PermissionsModule],
  exports: [RolesService],
})
export class RolesModule {}
