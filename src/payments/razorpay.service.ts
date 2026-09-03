import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';

export type RazorpayOrderRequest = {
  amountInPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
};

/**
 * The two Razorpay primitives the store actually needs: create an order for a
 * server-calculated amount, and prove a payment belongs to that order.
 *
 * PaymentsService keeps its own client instance untouched, because section 14
 * forbids disturbing the working retail checkout. This exists so wholesale
 * gets the same guarantees without copy-pasting the HMAC rule, and retail can
 * be pointed here as a separate change.
 */
@Injectable()
export class RazorpayService {
  private readonly client: Razorpay;

  constructor(private readonly configService: ConfigService) {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');

    if (!keyId || !keySecret) {
      throw new Error('Razorpay credentials are not configured');
    }

    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  get keyId(): string {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');

    if (!keyId) {
      throw new BadRequestException('Razorpay key is not configured');
    }

    return keyId;
  }

  async createOrder(request: RazorpayOrderRequest) {
    const order = await this.client.orders.create({
      amount: request.amountInPaise,
      currency: request.currency,
      receipt: request.receipt,
      notes: request.notes,
    });

    return {
      razorpayOrderId: order.id,
      amount: Number(order.amount),
      currency: order.currency,
    };
  }

  verifyPaymentSignature(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    presentedSignature: string,
  ): boolean {
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');

    if (!keySecret) {
      throw new BadRequestException('Razorpay secret is not configured');
    }

    const expected = createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expected.length !== presentedSignature?.length) {
      return false;
    }

    return timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(presentedSignature),
    );
  }
}
