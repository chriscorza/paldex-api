import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './auth.decorator';
import { User, Prisma } from '@prisma/client';
import { UserService } from 'src/user/user.service';


@Controller('auth')
export class AuthController {
  userService: UserService;
  constructor(private readonly authService: AuthService) {}

  @Public()

  @Post('login')
  async login(
    @Body() loginData: { email: string; password: string },
  ): Promise<{ access_token: string }> {
    return this.authService.signIn(loginData.email, loginData.password);
  }
  
  @Post('user')
  async signupUser(
    @Body() userData: Prisma.UserCreateInput,
  ): Promise<User> {
    return this.userService.createUser(userData);
  }
}
