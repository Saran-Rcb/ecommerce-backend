import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShippingService {
  private shiprocketToken: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================
  // SHIPROCKET LOGIN
  // ==========================================

  async loginToShiprocket() {
    const email =
      this.configService.get<string>(
        'SHIPROCKET_EMAIL',
      );

    const password =
      this.configService.get<string>(
        'SHIPROCKET_PASSWORD',
      );

    if (!email || !password) {
      throw new BadRequestException(
        'Shiprocket credentials are not configured',
      );
    }

    try {
      const response = await fetch(
        'https://apiv2.shiprocket.in/v1/external/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            email,
            password,
          }),
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new BadRequestException(
          data?.message ||
            'Shiprocket authentication failed',
        );
      }

      this.shiprocketToken =
        data.token;

      return {
        message:
          'Shiprocket authentication successful',
      };
    } catch (error) {
      if (
        error instanceof
        BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Unable to connect to Shiprocket',
      );
    }
  }

  // ==========================================
  // GET SHIPROCKET TOKEN
  // ==========================================

  private async getShiprocketToken() {
    if (this.shiprocketToken) {
      return this.shiprocketToken;
    }

    await this.loginToShiprocket();

    if (!this.shiprocketToken) {
      throw new InternalServerErrorException(
        'Shiprocket token was not received',
      );
    }

    return this.shiprocketToken;
  }

  // ==========================================
  // CREATE SHIPROCKET SHIPMENT
  // ==========================================

  async createShipmentForOrder(
    orderId: number,
  ) {
    const order =
      await this.prisma.order.findUnique({
        where: {
          id: orderId,
        },

        include: {
          user: true,
          address: true,

          items: {
            include: {
              product: true,
            },
          },
        },
      });

    if (!order) {
      throw new NotFoundException(
        'Order not found',
      );
    }

    if (order.status !== 'PAID') {
      throw new BadRequestException(
        'Only PAID orders can be sent to Shiprocket',
      );
    }

    if (!order.address) {
      throw new BadRequestException(
        'This order does not have a delivery address',
      );
    }

    if (order.items.length === 0) {
      throw new BadRequestException(
        'Order has no items',
      );
    }

    // Prevent duplicate Shiprocket orders
    if (order.shiprocketOrderId) {
      return {
        message:
          'Order is already connected to Shiprocket',

        orderId:
          order.id,

        addressId:
          order.addressId,

        shiprocketOrderId:
          order.shiprocketOrderId,

        shiprocketShipmentId:
          order.shiprocketShipmentId,

        awbCode:
          order.awbCode,

        courierName:
          order.courierName,

        trackingUrl:
          order.trackingUrl,
      };
    }

    const token =
      await this.getShiprocketToken();

    const address =
      order.address;

    const orderItems =
      order.items.map(
        (item) => ({
          name:
            item.product.name,

          sku:
            `PRODUCT-${item.productId}`,

          units:
            item.quantity,

          selling_price:
            item.price,

          discount: 0,

          tax: 0,

          hsn: 6109,
        }),
      );

    const subTotal =
      order.items.reduce(
        (total, item) =>
          total +
          item.price *
            item.quantity,
        0,
      );

    const shipmentData = {
      order_id:
        `ECOM-${order.id}`,

      order_date:
        order.createdAt.toISOString(),

      pickup_location:
        'home',

      billing_customer_name:
        address.fullName,

      billing_last_name:
        '',

      billing_address:
        address.address,

      billing_address_2:
        '',

      billing_city:
        address.city,

      billing_pincode:
        address.postalCode,

      billing_state:
        address.state,

      billing_country:
        'India',

      billing_email:
        order.user.email,

      billing_phone:
        address.phone,

      shipping_is_billing:
        true,

      shipping_customer_name:
        address.fullName,

      shipping_last_name:
        '',

      shipping_address:
        address.address,

      shipping_address_2:
        '',

      shipping_city:
        address.city,

      shipping_pincode:
        address.postalCode,

      shipping_country:
        'India',

      shipping_state:
        address.state,

      shipping_email:
        order.user.email,

      shipping_phone:
        address.phone,

      order_items:
        orderItems,

      payment_method:
        'Prepaid',

      sub_total:
        subTotal,

      length: 20,

      breadth: 15,

      height: 5,

      weight: 0.5,
    };

    try {
      const response = await fetch(
        'https://apiv2.shiprocket.in/v1/external/orders/create/adhoc',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${token}`,
          },

          body: JSON.stringify(
            shipmentData,
          ),
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new BadRequestException(
          data?.message ||
            'Shiprocket order creation failed',
        );
      }

      const shiprocketOrderId =
        data?.order_id;

      const shiprocketShipmentId =
        data?.shipment_id;

      if (
        !shiprocketOrderId ||
        !shiprocketShipmentId
      ) {
        throw new BadRequestException(
          'Shiprocket did not return order/shipment IDs',
        );
      }

      const updatedOrder =
        await this.prisma.order.update({
          where: {
            id: order.id,
          },

          data: {
            shiprocketOrderId:
              String(
                shiprocketOrderId,
              ),

            shiprocketShipmentId:
              String(
                shiprocketShipmentId,
              ),
          },
        });

      return {
        message:
          'Order connected to Shiprocket successfully',

        orderId:
          updatedOrder.id,

        addressId:
          updatedOrder.addressId,

        shiprocketOrderId:
          updatedOrder.shiprocketOrderId,

        shiprocketShipmentId:
          updatedOrder.shiprocketShipmentId,

        status:
          data?.status,
      };
    } catch (error) {
      if (
        error instanceof
          BadRequestException ||
        error instanceof
          NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Unable to create Shiprocket shipment',
      );
    }
  }

  // ==========================================
  // GET AVAILABLE COURIERS
  // ==========================================

  async getAvailableCouriers(
    orderId: number,
    shipmentId: number,
  ) {
    const token =
      await this.getShiprocketToken();

    try {
      const response = await fetch(
        `https://apiv2.shiprocket.in/v1/external/courier/serviceability?order_id=${orderId}&shipment_id=${shipmentId}`,
        {
          method: 'GET',

          headers: {
            Authorization:
              `Bearer ${token}`,

            'Content-Type':
              'application/json',
          },
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new BadRequestException(
          data?.message ||
            'Unable to get available couriers',
        );
      }

      return data;
    } catch (error) {
      if (
        error instanceof
        BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Unable to connect to Shiprocket',
      );
    }
  }

  // ==========================================
  // ASSIGN COURIER / AWB
  // ==========================================

  async assignCourier(
    shipmentId: number,
    courierId: number,
  ) {
    const token =
      await this.getShiprocketToken();

    try {
      const response = await fetch(
        'https://apiv2.shiprocket.in/v1/external/courier/assign/awb',
        {
          method: 'POST',

          headers: {
            Authorization:
              `Bearer ${token}`,

            'Content-Type':
              'application/json',
          },

          body: JSON.stringify({
            shipment_id:
              shipmentId,

            courier_id:
              courierId,
          }),
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new BadRequestException(
          data?.message ||
            'Unable to assign courier',
        );
      }

      // ----------------------------------------
      // Extract AWB information
      // ----------------------------------------

      const awbCode =
        data?.response?.data
          ?.awb_code ||
        data?.awb_code ||
        null;

      const courierName =
        data?.response?.data
          ?.courier_name ||
        data?.courier_name ||
        null;

      // ----------------------------------------
      // Find our order using shipment ID
      // ----------------------------------------

      const order =
        await this.prisma.order.findFirst({
          where: {
            shiprocketShipmentId:
              String(shipmentId),
          },
        });

      // ----------------------------------------
      // Save AWB information
      // ----------------------------------------

      if (order) {
        await this.prisma.order.update({
          where: {
            id: order.id,
          },

          data: {
            awbCode:
              awbCode
                ? String(awbCode)
                : null,

            courierName:
              courierName
                ? String(courierName)
                : null,

            trackingUrl:
              awbCode
                ? `https://www.shiprocket.in/shipment-tracking/${awbCode}`
                : null,
          },
        });
      }

      return {
        message:
          'Courier assigned successfully',

        shipmentId,

        courierId,

        awbCode,

        courierName,

        trackingUrl:
          awbCode
            ? `https://www.shiprocket.in/shipment-tracking/${awbCode}`
            : null,

        shiprocketResponse:
          data,
      };
    } catch (error) {
      if (
        error instanceof
        BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Unable to connect to Shiprocket',
      );
    }
  }

  // ==========================================
  // GET SHIPMENT STATUS
  // ==========================================

  async getShipmentStatus(
    shipmentId: number,
  ) {
    const token =
      await this.getShiprocketToken();

    try {
      const response = await fetch(
        `https://apiv2.shiprocket.in/v1/external/shipments/${shipmentId}`,
        {
          method: 'GET',

          headers: {
            Authorization:
              `Bearer ${token}`,

            'Content-Type':
              'application/json',
          },
        },
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new BadRequestException(
          data?.message ||
            'Unable to get shipment status',
        );
      }

      return data;
    } catch (error) {
      if (
        error instanceof
        BadRequestException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Unable to connect to Shiprocket',
      );
    }
  }

  // ==========================================
  // GET SHIPPING DETAILS FOR OUR ORDER
  // ==========================================

  async getShippingDetails(
    orderId: number,
  ) {
    const order =
      await this.prisma.order.findUnique({
        where: {
          id: orderId,
        },

        select: {
          id: true,
          status: true,
          addressId: true,
          shiprocketOrderId: true,
          shiprocketShipmentId: true,
          awbCode: true,
          courierName: true,
          trackingUrl: true,
        },
      });

    if (!order) {
      throw new NotFoundException(
        'Order not found',
      );
    }

    if (
      !order.shiprocketShipmentId
    ) {
      return {
        message:
          'Order has not been connected to Shiprocket yet',

        order,
      };
    }

    const shipment =
      await this.getShipmentStatus(
        Number(
          order.shiprocketShipmentId,
        ),
      );

    return {
      order,
      shipment,
    };
  }
}