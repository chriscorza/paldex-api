import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './auth.decorator';
import { UserService } from 'src/user/user.service';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { SafeUser } from 'src/user/entities/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({
    summary: 'Iniciar sesión',
    description:
      'Autentica con email y contraseña. Devuelve un JWT que debe enviarse en cada petición protegida como `Authorization: Bearer <token>`. Caduca a los 7 días.',
  })
  @ApiOkResponse({ description: 'Token emitido correctamente' })
  async login(@Body() loginData: LoginDto): Promise<{ access_token: string }> {
    return this.authService.signIn(loginData.email, loginData.password);
  }

  @Public()
  @Post('login/google')
  @ApiOperation({
    summary: 'Iniciar sesión con Google',
    description:
      'Verifica el ID token de Google (firma y audiencia) con la librería oficial — nunca se confía en un token decodificado del lado del cliente. Crea el usuario si no existe (rol `user` por defecto) o lo actualiza si ya existía. Devuelve un JWT con el mismo shape que /auth/login.',
  })
  @ApiOkResponse({ description: 'Token emitido correctamente' })
  async googleLogin(
    @Body() googleLoginData: GoogleLoginDto,
  ): Promise<{ access_token: string }> {
    return this.authService.googleLogin(googleLoginData.credential);
  }

  @Public()
  @Post('user')
  @ApiOperation({
    summary: 'Registrar un usuario nuevo',
    description:
      'Crea la cuenta y le asigna el rol `user` por defecto. No devuelve la contraseña ni el token de Google en ningún caso. No inicia sesión automáticamente — hay que llamar a /auth/login después.',
  })
  @ApiCreatedResponse({ description: 'Usuario creado' })
  async signupUser(@Body() userData: CreateUserDto): Promise<SafeUser> {
    return this.userService.createUser(userData);
  }
}
