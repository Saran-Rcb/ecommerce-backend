import { BadRequestException } from '@nestjs/common';

// The configurator on the site renders whatever these numbers produce. The
// browser's own arithmetic is never trusted: this is the only place a payable
// wholesale amount may be calculated.
export const WHOLESALE_CURRENCY = 'INR';

export const WHOLESALE_MIN_QUANTITY = 5;
export const WHOLESALE_MAX_QUANTITY = 50;

// Ordered highest-volume-first so the first match is the applicable tier.
const TIERS: { minQuantity: number; unitPrice: number }[] = [
  { minQuantity: 30, unitPrice: 28 },
  { minQuantity: 15, unitPrice: 32 },
  { minQuantity: 5, unitPrice: 38 },
];

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export type WholesaleQuote = {
  unitPrice: number;
  quantity: number;
  totalAmount: number;
  currency: string;
};

export function quoteWholesale(quantity: number): WholesaleQuote {
  if (!Number.isInteger(quantity)) {
    throw new BadRequestException('Quantity must be a whole number.');
  }

  if (
    quantity < WHOLESALE_MIN_QUANTITY ||
    quantity > WHOLESALE_MAX_QUANTITY
  ) {
    throw new BadRequestException(
      `Quantity must be between ${WHOLESALE_MIN_QUANTITY} and ${WHOLESALE_MAX_QUANTITY} units.`,
    );
  }

  const tier = TIERS.find((t) => quantity >= t.minQuantity);

  if (!tier) {
    throw new BadRequestException('No wholesale price tier applies.');
  }

  return {
    unitPrice: round2(tier.unitPrice),
    quantity,
    currency: WHOLESALE_CURRENCY,
    totalAmount: round2(tier.unitPrice * quantity),
  };
}
