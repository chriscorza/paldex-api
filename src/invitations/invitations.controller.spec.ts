import { Test, TestingModule } from '@nestjs/testing';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

describe('InvitationsController', () => {
  let controller: InvitationsController;
  let service: any;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      revoke: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [{ provide: InvitationsService, useValue: service }],
    }).compile();

    controller = module.get<InvitationsController>(InvitationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should invite using the current admin as invited_by', async () => {
    service.create.mockResolvedValue({
      id: 1,
      email: 'ana@empresa.com',
      status: 'PENDING',
      user_id: null,
      invited_by: 9,
    });

    const result = await controller.create(
      { id: 9, email: 'admin@empresa.com' },
      { email: 'ana@empresa.com' },
    );

    expect(service.create).toHaveBeenCalledWith('ana@empresa.com', 9);
    expect(result).not.toHaveProperty('password');
    expect(result.status).toBe('PENDING');
  });

  it('should list invitations as returned by the service', async () => {
    service.findAll.mockResolvedValue([
      { id: 1, status: 'PENDING' },
      { id: 2, status: 'REVOKED' },
    ]);

    const result = await controller.findAll();

    expect(result).toHaveLength(2);
  });

  it('should revoke by id', async () => {
    service.revoke.mockResolvedValue({ id: 1, status: 'REVOKED' });

    const result = await controller.revoke(1);

    expect(service.revoke).toHaveBeenCalledWith(1);
    expect(result.status).toBe('REVOKED');
  });
});
