import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingService } from '../shipping/shipping.service';
import { ConfigService } from '@nestjs/config';

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                RAZORPAY_KEY_ID: 'test_key',
                RAZORPAY_KEY_SECRET: 'test_secret',
              };

              return values[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ShippingService,
          useValue: {
            autoCreateShipment: jest.fn().mockResolvedValue({ created: false }),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
