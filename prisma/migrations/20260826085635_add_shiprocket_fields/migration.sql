/*
  Warnings:

  - A unique constraint covering the columns `[shiprocketOrderId]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "awbCode" TEXT,
ADD COLUMN     "courierName" TEXT,
ADD COLUMN     "shiprocketOrderId" TEXT,
ADD COLUMN     "shiprocketShipmentId" TEXT,
ADD COLUMN     "trackingUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_shiprocketOrderId_key" ON "Order"("shiprocketOrderId");
