-- Additive only: shipping lifecycle fields on Order.
-- Existing orders keep NULL, so no order data is modified or removed.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingStatus" TEXT,
ADD COLUMN     "shippingSyncedAt" TIMESTAMP(3);
