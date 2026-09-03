import type { OrderStatusValue } from './dto/update-order-status.dto';

/**
 * Single source of truth for the fulfilment lifecycle. The admin status API
 * and carrier-driven sync both read it, so a status arriving from Shiprocket
 * can never take a shortcut the admin is not allowed to take.
 */
export const ALLOWED_TRANSITIONS: Record<
  OrderStatusValue,
  OrderStatusValue[]
> = {
  PENDING: ['CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

// Stock is deducted only once a payment succeeds, so cancelling before that
// point has nothing to give back.
export const STOCK_RETURNED_ON_CANCEL: OrderStatusValue[] = [
  'PAID',
  'PROCESSING',
];

/**
 * Shortest legal path from `from` to `to`, excluding `from` itself. Returns an
 * empty array when the target is unreachable, which is how an unknown or
 * backwards carrier status is refused instead of guessed at.
 */
export function transitionPath(
  from: OrderStatusValue,
  to: OrderStatusValue,
): OrderStatusValue[] {
  if (from === to) return [];

  const previous = new Map<OrderStatusValue, OrderStatusValue>();
  const queue: OrderStatusValue[] = [from];
  const seen = new Set<OrderStatusValue>([from]);

  while (queue.length > 0) {
    const current = queue.shift() as OrderStatusValue;

    for (const next of ALLOWED_TRANSITIONS[current] ?? []) {
      if (seen.has(next)) continue;

      seen.add(next);
      previous.set(next, current);

      if (next === to) {
        const path: OrderStatusValue[] = [];
        let node = to;
        while (node !== from) {
          path.unshift(node);
          node = previous.get(node) as OrderStatusValue;
        }
        return path;
      }

      queue.push(next);
    }
  }

  return [];
}
