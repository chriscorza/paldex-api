import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { UserModule } from './user/user.module';
import { IncomesModule } from './incomes/incomes.module';

@Module({
  imports: [AuthModule, ConfigModule.forRoot({
    envFilePath: '.env.prod'
  }), UserModule, IncomesModule],
  controllers: [AppController],
  providers: [AppService,{
    provide: APP_GUARD,
    useClass: AuthGuard
  }],
})
export class AppModule {}
