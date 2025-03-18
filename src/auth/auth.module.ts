import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { env } from 'process';
import { UserModule } from 'src/user/user.module';
import { UserService } from 'src/user/user.service';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [AuthController],
  providers: [AuthService, UserService],
  imports:[
    JwtModule.register({
      secret: env.JWT_SECRET,
      global: true,
      signOptions:{
        expiresIn: '7 days'
      }
    }),
    UserModule,
    PrismaModule
  ]
})
export class AuthModule {}
