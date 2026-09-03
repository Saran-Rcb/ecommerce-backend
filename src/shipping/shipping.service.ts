import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { OrderStatusValue } from '../orders/dto/update-order-status.dto';
import { transitionPath } from '../orders/order-lifecycle';
import { ShiprocketClient } from './shiprocket.client';

/**
 * Shipping state is tracked separately from the order status enum: the carrier
 * knows things the order lifecycle does not (courier assigned, RTO), and the
 * order lifecycle stays authoritative for what the customer is shown.
 */
export const SHIPPING_STATUS = {
  CREATED: 'CREATED',
  COURIER_ASSIGNED: 'COURIER_ASSIGNED',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RTO_INITIATED: 'RTO_INITIATED',
  RTO_DELIVERED: 'RTO_DELIVERED',
} as const;

export type ShippingStatusValue =
  (typeof SHIPPING_STATUS)[keyof typeof SHIPPING_STATUS];

/**
 * Carrier status -> our shipping vocabulary.
 *
 * NEW, INVOICED and CANCELED (plus shipment status PENDING) were observed on
 * the live account through /orders/show. The remaining keys follow the same
 * naming Shiprocket uses for its order statuses. Anything unrecognised maps to
 * undefined, which leaves the stored record untouched rather than guessing.
 */
const CARRIER_STATUS_MAP: Record<string, ShippingStatusValue | undefined> = {
  NEW: SHIPPING_STATUS.CREATED,
  CREATED: SHIPPING_STATUS.CREATED,
  INVOICED: SHIPPING_STATUS.CREATED,
  PENDING: SHIPPING_STATUS.CREATED,
  READY_TO_SHIP: SHIPPING_STATUS.COURIER_ASSIGNED,
  PICKUP_SCHEDULED: SHIPPING_STATUS.COURIER_ASSIGNED,
  PICKUP_PENDING: SHIPPING_STATUS.COURIER_ASSIGNED,
  PICKED_UP: SHIPPING_STATUS.IN_TRANSIT,
  SHIPPED: SHIPPING_STATUS.IN_TRANSIT,
  IN_TRANSIT: SHIPPING_STATUS.IN_TRANSIT,
  OUT_FOR_DELIVERY: SHIPPING_STATUS.OUT_FOR_DELIVERY,
  DELIVERED: SHIPPING_STATUS.DELIVERED,
  CANCELED: SHIPPING_STATUS.CANCELLED,
  CANCELLED: SHIPPING_STATUS.CANCELLED,
  RTO_INITIATED: SHIPPING_STATUS.RTO_INITIATED,
  RTO_STARTED: SHIPPING_STATUS.RTO_INITIATED,
  RTO_FAILED: SHIPPING_STATUS.RTO_INITIATED,
  RTO_DELIVERED: SHIPPING_STATUS.RTO_DELIVERED,
};

/**
 * Shipping progress is only allowed to move the order forward, and only to the
 * fulfilment stages a carrier can actually prove. CREATED and
 * COURIER_ASSIGNED deliberately have no order status: the admin still owns
 * those transitions.
 */
const SHIPPING_TO_ORDER_STATUS: Partial<
  Record<ShippingStatusValue, OrderStatusValue>
> = {
  [SHIPPING_STATUS.IN_TRANSIT]: 'SHIPPED',
  [SHIPPING_STATUS.OUT_FOR_DELIVERY]: 'OUT_FOR_DELIVERY',
  [SHIPPING_STATUS.DELIVERED]: 'DELIVERED',
};

export type AutoShipmentResult =
  | { created: true; message: string }
  | { created: false; reason: string };

type ShippingOrder = {
  id: number;
  status: OrderStatusValue;
  shiprocketOrderId: string | null;
  shiprocketShipmentId: string | null;
  awbCode: string | null;
  courierName: string | null;
  trackingUrl: string | null;
  shippingStatus: string | null;
  shippingSyncedAt: Date | null;
};

const SHIPPING_SELECT = {
  id: true,
  status: true,
  shiprocketOrderId: true,
  shiprocketShipmentId: true,
  awbCode: true,
  courierName: true,
  trackingUrl: true,
  shippingStatus: true,
  shippingSyncedAt: true,
} as const;

/** Values Shiprocket sends as the JSON string "null" for an unset field. */
function clean(value: unknown): string | null {
  if (typeof value !== 'string') {
    return value === undefined || value === null ? null : String(value);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shiprocket: ShiprocketClient,
  ) {}

  // ==========================================
  // CONFIGURATION STATE (CREDENTIAL FREE)
  // ==========================================

  /**
   * Lets the admin UI explain why a shipping action is unavailable without
   * ever touching the network or revealing secret values.
   */
  configuration() {
    const state = this.shiprocket.state();
    const packing = this.shiprocket.parcelDefaults();

    const blockers: string[] = [];
    if (!state.configured) {
      blockers.push(`Missing ${state.missingEnv.join(', ')}`);
    }
    if (!state.enabled) blockers.push('SHIPROCKET_ENABLED is not true');
    if (!packing) blockers.push('Missing SHIPROCKET_PARCEL_* packing setup');
    if (!this.shiprocket.pickupLocation()) {
      blockers.push('Missing SHIPROCKET_PICKUP_LOCATION');
    }

    return {
      shiprocket: {
        configured: state.configured,
        enabled: state.enabled,
        baseUrl: state.baseUrl,
        missingEnv: state.missingEnv,
        pickupLocationConfigured: Boolean(this.shiprocket.pickupLocation()),
        packingConfigured: Boolean(packing),
      },
      liveOperationsReady: blockers.length === 0,
      blockers,
    };
  }

  /** Proves the stored credentials authenticate. Reports failures verbatim. */
  async testConnection() {
    await this.shiprocket.verifyCredentials();

    return {
      message: 'Shiprocket authentication successful',
      baseUrl: this.shiprocket.baseUrl,
    };
  }

  // ==========================================
  // LOCAL SHIPPING RECORD (CREDENTIAL FREE)
  // ==========================================

  /**
   * Pure database read, so order tracking works with no Shiprocket account at
   * all. Nothing is synthesised: absent fields stay absent.
   */
  async getOrderShipping(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        ...SHIPPING_SELECT,
        user: { select: { id: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.view(order);
  }

  /** Same read, scoped to the requesting customer. */
  async getOrderShippingForUser(userId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        ...SHIPPING_SELECT,
        user: { select: { id: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.view(order);
  }

  private view(order: ShippingOrder & { user?: { id: number } }) {
    const connected = Boolean(order.shiprocketOrderId);

    return {
      orderId: order.id,
      orderStatus: order.status,
      connected,
      shiprocketOrderId: order.shiprocketOrderId,
      shiprocketShipmentId: order.shiprocketShipmentId,
      courierName: order.courierName,
      awbCode: order.awbCode,
      trackingUrl: order.trackingUrl,
      shippingStatus: order.shippingStatus,
      shippingSyncedAt: order.shippingSyncedAt,
      // The customer only ever sees tracking when the carrier really produced
      // an AWB and a URL for it.
      hasTracking: Boolean(order.awbCode && order.trackingUrl),
    };
  }

  // ==========================================
  // CREATE SHIPMENT
  // ==========================================

  /**
   * Called by the payment flow. Never throws: a missing or failing carrier
   * must not turn a successful payment into an error, and the reason has to be
   * reported honestly instead of as a silent no-op.
   */
  async autoCreateShipment(orderId: number): Promise<AutoShipmentResult> {
    if (!this.shiprocket.autoCreateEnabled) {
      return {
        created: false,
        reason:
          'Shiprocket auto-creation is off (SHIPROCKET_ENABLED). Change the order status manually or enable it.',
      };
    }

    if (!this.shiprocket.hasCredentials) {
      return {
        created: false,
        reason: 'Shiprocket credentials are not configured.',
      };
    }

    try {
      const result = await this.createShipmentForOrder(orderId);

      return { created: true, message: result.message };
    } catch (error) {
      this.logger.error(
        `Shiprocket shipment creation failed for order ${orderId}: ${(error as Error).message}`,
      );

      return {
        created: false,
        reason: (error as Error).message,
      };
    }
  }

  async createShipmentForOrder(orderId: number) {
    this.shiprocket.assertConfigured();

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: true,
        address: true,
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, sku: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.status !== 'PAID') {
      throw new BadRequestException(
        `Only PAID orders can be sent to Shiprocket (this order is ${order.status})`,
      );
    }

    if (!order.address) {
      throw new BadRequestException(
        'This order does not have a delivery address',
      );
    }

    if (order.items.length === 0) {
      throw new BadRequestException('Order has no items');
    }

    if (order.shiprocketOrderId) {
      return {
        message: 'Order is already connected to Shiprocket',
        alreadyConnected: true,
        shipping: this.view(order),
      };
    }

    // SKUs come from the catalog. An item without one is reported instead of
    // being sent under a made-up code.
    const orderItems = order.items.map((item) => {
      const sku = clean(item.variant?.sku) ?? clean(item.product.sku);

      if (!sku) {
        throw new BadRequestException(
          `Product "${item.product.name}" has no SKU. Add one before shipping through Shiprocket.`,
        );
      }

      return {
        name: item.product.name,
        sku,
        units: item.quantity,
        selling_price: item.price,
        discount: 0,
        tax: 0,
      };
    });

    const pickupLocation = this.shiprocket.pickupLocation();
    if (!pickupLocation) {
      throw new BadRequestException(
        'Set SHIPROCKET_PICKUP_LOCATION to a pickup location configured in the Shiprocket account.',
      );
    }

    const packing = this.shiprocket.parcelDefaults();
    if (!packing) {
      throw new BadRequestException(
        'Set SHIPROCKET_PARCEL_WEIGHT, SHIPROCKET_PARCEL_LENGTH, SHIPROCKET_PARCEL_BREADTH and SHIPROCKET_PARCEL_HEIGHT. This catalog stores no per-product weight or dimensions.',
      );
    }

    const subTotal = order.items.reduce(
      (total, item) => total + item.price * item.quantity,
      0,
    );

    const shipmentData = {
      order_id: `ECOM-${order.id}`,
      order_date: order.createdAt.toISOString(),
      pickup_location: pickupLocation,
      shipping_is_billing: true,
      payment_method: order.razorpayPaymentId ? 'Prepaid' : 'COD',
      sub_total: subTotal,
      billing_customer_name: order.address.fullName,
      billing_last_name: '',
      billing_address: order.address.address,
      billing_address_2: '',
      billing_city: order.address.city,
      billing_pincode: order.address.postalCode,
      billing_state: order.address.state,
      billing_country: 'India',
      billing_email: order.user.email,
      billing_phone: order.address.phone,
      shipping_customer_name: order.address.fullName,
      shipping_last_name: '',
      shipping_address: order.address.address,
      shipping_address_2: '',
      shipping_city: order.address.city,
      shipping_pincode: order.address.postalCode,
      shipping_state: order.address.state,
      shipping_country: 'India',
      shipping_email: order.user.email,
      shipping_phone: order.address.phone,
      order_items: orderItems,
      ...packing,
    };

    const data = await this.shiprocket.post<Record<string, unknown>>(
      '/orders/create/adhoc',
      shipmentData,
    );

    const shiprocketOrderId = clean(data?.order_id);
    const shiprocketShipmentId = clean(data?.shipment_id);

    if (!shiprocketOrderId || !shiprocketShipmentId) {
      throw new BadRequestException(
        'Shiprocket accepted the request but returned no order/shipment id',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        shiprocketOrderId,
        shiprocketShipmentId,
        // The shipment provably exists with the carrier now. Its later
        // lifecycle comes from syncShippingStatus, not from this response.
        shippingStatus: SHIPPING_STATUS.CREATED,
        shippingSyncedAt: new Date(),
      },
      select: {
        ...SHIPPING_SELECT,
        user: { select: { id: true } },
      },
    });

    return {
      message: 'Order connected to Shiprocket successfully',
      alreadyConnected: false,
      shipping: this.view(updated),
      errors: data?.errors ?? null,
    };
  }

  // ==========================================
  // COURIER SELECTION AND AWB
  // ==========================================

  async getAvailableCouriers(orderId: number) {
    this.shiprocket.assertConfigured();

    const order = await this.requireShipment(orderId);

    const serviceable = await this.shiprocket.get<Record<string, unknown>>(
      `/courier/serviceability/?order_id=${order.shiprocketOrderId}&shipment_id=${order.shiprocketShipmentId}&pickup_location=${encodeURIComponent(
        this.shiprocket.pickupLocation() ?? 'warehouse',
      )}`,
    );

    // Passed through as returned. The payload shape could not be observed on
    // this account (serviceability reported no couriers), so nothing is
    // reshaped into a format that might not match.
    return {
      orderId,
      shipmentId: order.shiprocketShipmentId,
      serviceability: serviceable?.data ?? serviceable,
    };
  }

  async assignCourier(orderId: number, courierId: number) {
    this.shiprocket.assertConfigured();

    if (!Number.isInteger(courierId) || courierId <= 0) {
      throw new BadRequestException('courierId must be a positive integer');
    }

    const order = await this.requireShipment(orderId);

    const data = await this.shiprocket.post<Record<string, any>>(
      '/courier/assign/awb',
      {
        shipment_id: Number(order.shiprocketShipmentId),
        courier_id: courierId,
      },
    );

    const assigned = data?.response?.data ?? data ?? {};
    const awbCode = clean(assigned?.awb_code) ?? clean(data?.awb_code);
    const courierName =
      clean(assigned?.courier_name) ?? clean(data?.courier_name);

    if (Number(data?.awb_assign_status ?? 1) !== 1) {
      throw new BadRequestException(
        clean(data?.message) ?? 'Shiprocket could not assign the AWB',
      );
    }

    if (!awbCode) {
      throw new BadRequestException(
        'Shiprocket assigned the courier but returned no AWB code',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        awbCode,
        courierName,
        // Prefer the carrier-provided tracking link; fall back to Shiprocket's
        // public tracking page for a real AWB. Never stored without an AWB.
        trackingUrl:
          clean(assigned?.tracking_url) ??
          clean(data?.tracking_url) ??
          `https://www.shiprocket.in/shipment-tracking/${awbCode}`,
        shippingStatus: SHIPPING_STATUS.COURIER_ASSIGNED,
        shippingSyncedAt: new Date(),
      },
      select: {
        ...SHIPPING_SELECT,
        user: { select: { id: true } },
      },
    });

    return {
      message: `Courier assigned for order #${order.id}`,
      shipping: this.view(updated),
    };
  }

  // ==========================================
  // STATUS AND TRACKING SYNC
  // ==========================================

  /**
   * Pulls the carrier's view of an order, stores the real AWB / courier /
   * tracking values it reports, and only then advances the order status along
   * transitions the normal lifecycle already allows.
   */
  async syncShippingStatus(orderId: number) {
    this.shiprocket.assertConfigured();

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        ...SHIPPING_SELECT,
        user: { select: { id: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!order.shiprocketOrderId) {
      throw new BadRequestException(
        'Order is not connected to Shiprocket yet',
      );
    }

    const payload = await this.shiprocket.get<Record<string, any>>(
      `/orders/show/${order.shiprocketOrderId}`,
    );

    const carrier = payload?.data ?? {};
    const shipment = carrier?.shipments && !Array.isArray(carrier.shipments)
      ? carrier.shipments
      : {};

    const carrierStatus =
      clean(carrier?.status) ?? clean(shipment?.status_code) ?? '';

    const shippingStatus = CARRIER_STATUS_MAP[carrierStatus.toUpperCase()];

    if (!shippingStatus) {
      return {
        message: `Shiprocket reported "${carrierStatus || 'no status'}", which this integration does not map. Nothing was changed.`,
        mapped: false,
        carrierStatus: carrierStatus || null,
        shipping: this.view(order),
      };
    }

    const awbCode =
      clean(carrier?.last_mile_awb) ??
      clean(shipment?.awb) ??
      clean(shipment?.last_mile_awb) ??
      order.awbCode;

    const courierName =
      clean(carrier?.last_mile_courier_name) ??
      clean(shipment?.courier_name) ??
      order.courierName;

    const trackingUrl =
      clean(carrier?.last_mile_awb_track_url) ??
      (awbCode && !order.trackingUrl
        ? `https://www.shiprocket.in/shipment-tracking/${awbCode}`
        : order.trackingUrl);

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        shippingStatus,
        shippingSyncedAt: new Date(),
        awbCode,
        courierName,
        trackingUrl,
        ...(carrier?.shipments?.id && !order.shiprocketShipmentId
          ? { shiprocketShipmentId: String(carrier.shipments.id) }
          : {}),
      },
      select: {
        ...SHIPPING_SELECT,
        user: { select: { id: true } },
      },
    });

    const target = SHIPPING_TO_ORDER_STATUS[shippingStatus];
    const path = target ? transitionPath(order.status, target) : [];

    let orderStatus = order.status;
    if (path.length > 0) {
      const advanced = await this.prisma.order.update({
        where: { id: order.id },
        data: { status: path[path.length - 1] },
        select: { status: true },
      });
      orderStatus = advanced.status as OrderStatusValue;
    }

    return {
      message:
        path.length > 0
          ? `Order #${order.id} moved to ${orderStatus} from Shiprocket status "${carrierStatus}"`
          : `Shiprocket status "${carrierStatus}" recorded; order status left at ${order.status}`,
      mapped: true,
      carrierStatus,
      orderStatusAdvanced: path.length > 0,
      shipping: { ...this.view(updated), orderStatus },
    };
  }

  /**
   * Carrier tracking events for an order that already has a real AWB.
   * /shipments/track/{id} is not served by the External API on this account;
   * /courier/track/awb/{awb} is the endpoint that responds.
   */
  async trackShipment(orderId: number) {
    this.shiprocket.assertConfigured();

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: SHIPPING_SELECT,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!order.awbCode) {
      throw new BadRequestException(
        'No AWB has been assigned to this order yet, so there is nothing to track',
      );
    }

    const payload = await this.shiprocket.get<Record<string, any>>(
      `/courier/track/awb/${order.awbCode}`,
    );

    return {
      orderId,
      awbCode: order.awbCode,
      trackingUrl: order.trackingUrl,
      tracking: payload?.tracking_data ?? payload,
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private async requireShipment(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        shiprocketOrderId: true,
        shiprocketShipmentId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (!order.shiprocketOrderId || !order.shiprocketShipmentId) {
      throw new BadRequestException(
        'Create the Shiprocket shipment for this order first',
      );
    }

    return order;
  }
}
