import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const mockUserService = {
      createUser: jest.fn().mockResolvedValue({
        id: 1,
        email: 'new@test.com',
        name: 'New',
        photo_url: null,
        locale: 'es',
        created_at: new Date(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should not return password on signup', async () => {
    const result = await controller.signupUser({
      email: 'new@test.com',
      password: 'secret',
    });

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('google_token_id');
    expect(result).toHaveProperty('email');
    expect(result).toHaveProperty('id');
  });
});
