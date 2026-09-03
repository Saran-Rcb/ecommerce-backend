import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiprocketClient } from './shiprocket.client';

const UNCONFIGURED = {
  configured: false,
  enabled: false,
  baseUrl: 'https://apiv2.shiprocket.in/v1/external',
  missingEnv: ['SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD'],
};

const ORDER_ROW = {
  id: 34,
  status: 'PAID',
  shiprocketOrderId: '1556337733',
  shiprocketShipmentId: '1552556962',
  awbCode: null,
  courierName: null,
  trackingUrl: null,
  shippingStatus: null,
  shippingSyncedAt: null,
  user: { id: 7 },
};

describe('ShippingService with no Shiprocket credentials', () => {
  let service: ShippingService;
  const findUnique = jest.fn();

  beforeEach(async () => {
    findUnique.mockReset().mockResolvedValue(ORDER_ROW);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShippingService,
        { provide: PrismaService, useValue: { order: { findUnique } } },
        {
          provide: ShiprocketClient,
          useValue: {
            state: () => UNCONFIGURED,
            hasCredentials: false,
            autoCreateEnabled: false,
            parcelDefaults: () => null,
            pickupLocation: () => null,
            assertConfigured: () => {
              throw new ServiceUnavailableException(
                'Shiprocket is not configured.',
              );
            },
            get: jest.fn(),
            post: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ShippingService>(ShippingService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('reads the stored shipping record without touching the carrier', async () => {
    const shipping = await service.getOrderShipping(34);

    expect(shipping.connected).toBe(true);
    expect(shipping.hasTracking).toBe(false);
    expect(shipping.shippingStatus).toBeNull();
    expect(shipping.awbCode).toBeNull();
  });

  it('reports which configuration is missing without exposing secrets', () => {
    const config = service.configuration();

    expect(config.shiprocket.configured).toBe(false);
    expect(config.liveOperationsReady).toBe(false);
    expect(config.blockers.join(' ')).toContain('SHIPROCKET_EMAIL');
  });

  it('skips automatic shipment creation and explains why', async () => {
    const result = await service.autoCreateShipment(34);

    expect(result.created).toBe(false);
    expect(result.created ? '' : result.reason).toContain('SHIPROCKET_ENABLED');
  });

  it.each([
    ['createShipmentForOrder', () => service.createShipmentForOrder(34)],
    ['syncShippingStatus', () => service.syncShippingStatus(34)],
    ['getAvailableCouriers', () => service.getAvailableCouriers(34)],
    ['assignCourier', () => service.assignCourier(34, 1)],
    ['trackShipment', () => service.trackShipment(34)],
  ])('refuses %s with a configuration error', async (_name, call) => {
    await expect(call()).rejects.toThrow(ServiceUnavailableException);
  });
});
