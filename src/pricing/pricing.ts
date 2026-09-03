// Amazon/Flipkart style pricing:
//   mrp    = list price (strike-through)
//   price  = selling price (what the customer pays per unit)
//   discount = mrp - price, never negative
// All money math lives here so cart, order and payment amounts agree.

export const SHIPPING_CHARGE = 25;

export type PriceLine = {
  price: number;
  mrp?: number | null;
  quantity: number;
};

export type CartSummary = {
  itemCount: number;
  subtotal: number;
  discountAmount: number;
  shippingCharge: number;
  totalAmount: number;
};

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// A missing, zero or below-selling MRP means "no list price to compare".
export function listPrice(price: number, mrp?: number | null) {
  const list = round2(mrp ?? 0);
  return list > price ? list : round2(price);
}

export function discountPercentage(price: number, mrp?: number | null) {
  const list = listPrice(price, mrp);
  if (list <= price) return 0;
  return Math.round(((list - price) / list) * 100);
}

export function summarizePriceLines(lines: PriceLine[]): CartSummary {
  const subtotal = round2(
    lines.reduce(
      (sum, line) =>
        sum + listPrice(line.price, line.mrp) * line.quantity,
      0,
    ),
  );

  const itemsTotal = round2(
    lines.reduce(
      (sum, line) => sum + round2(line.price) * line.quantity,
      0,
    ),
  );

  const itemCount = lines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  return {
    itemCount,
    subtotal,
    discountAmount: round2(subtotal - itemsTotal),
    shippingCharge: itemCount > 0 ? SHIPPING_CHARGE : 0,
    totalAmount: round2(itemsTotal + (itemCount > 0 ? SHIPPING_CHARGE : 0)),
  };
}

// Orders persist only the payable total plus the two adjustment columns,
// so the MRP subtotal is derived back out of them. Legacy orders that were
// stored without discounts resolve to subtotal === totalAmount.
export function summarizeOrder(order: {
  totalAmount: number;
  discountAmount?: number | null;
  shippingCharge?: number | null;
  items?: { quantity: number }[];
}) {
  const totalAmount = round2(order.totalAmount);
  const discountAmount = round2(order.discountAmount ?? 0);
  const shippingCharge = round2(order.shippingCharge ?? 0);

  return {
    itemCount: (order.items ?? []).reduce(
      (sum, item) => sum + item.quantity,
      0,
    ),
    subtotal: round2(totalAmount + discountAmount - shippingCharge),
    discountAmount,
    shippingCharge,
    totalAmount,
  };
}
