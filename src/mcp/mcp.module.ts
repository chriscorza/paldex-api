import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ReportsModule } from '../reports/reports.module';
import { McpController } from './mcp.controller';
import { McpAuthorizationService } from './mcp-authorization.service';
import { McpToolsService } from './mcp-tools.service';

@Module({
  imports: [PrismaModule, PermissionsModule, ExpensesModule, ReportsModule],
  controllers: [McpController],
  providers: [McpAuthorizationService, McpToolsService],
})
export class McpModule {}
