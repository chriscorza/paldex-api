import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');
    if (!adminEmail) {
      const adminCount = await this.prisma.user.count({
        where: { role: { name: 'admin' } },
      });
      if (adminCount === 0) {
        this.logger.error(
          'No ADMIN_EMAIL set and no admin user exists. ' +
            'Set ADMIN_EMAIL in environment or run: npm run bootstrap:admin -- <email>',
        );
      }
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { email: adminEmail },
      include: { role: true },
    });

    if (!user) {
      this.logger.warn(
        `ADMIN_EMAIL is set to "${adminEmail}" but no user with that email exists. ` +
          'Register a user first or change ADMIN_EMAIL.',
      );
      return;
    }

    const adminRole = await this.prisma.role.findUnique({
      where: { name: 'admin' },
    });

    if (!adminRole) {
      this.logger.error('Admin role not found in database');
      return;
    }

    if (user.role?.name !== 'admin') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { role_id: adminRole.id },
      });
      this.logger.log(
        `Promoted user "${adminEmail}" (id=${user.id}) to admin role`,
      );
    }
  }
}
