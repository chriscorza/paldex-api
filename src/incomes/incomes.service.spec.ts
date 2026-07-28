import { Test, TestingModule } from '@nestjs/testing';
import { IncomesService } from './incomes.service';
import { PrismaService } from '../prisma.service';

describe('IncomesService', () => {
  let service: IncomesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IncomesService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<IncomesService>(IncomesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
