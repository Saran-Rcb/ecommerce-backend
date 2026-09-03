-- Phase 4: order lifecycle stage between SHIPPED and DELIVERED
-- Additive only: no rows, columns, or existing enum labels are touched.

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'OUT_FOR_DELIVERY';
