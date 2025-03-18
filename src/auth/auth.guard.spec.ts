import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { Reflector } from '@nestjs/core/services';

describe('AuthGuard', () => {
  it('should be defined', () => {
    const jwtService = {} as JwtService;
    const reflector = {} as Reflector;
    expect(new AuthGuard(jwtService, reflector)).toBeDefined();
  });
});
