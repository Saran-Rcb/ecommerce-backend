-- CreateEnum
CREATE TYPE "WholesaleOrderStatus" AS ENUM ('PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WholesaleOrder" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" INTEGER,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "company" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "accessKey" TEXT NOT NULL,
    "garment" TEXT NOT NULL,
    "fabric" TEXT NOT NULL,
    "colorway" TEXT NOT NULL,
    "sizes" TEXT[],
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "paidAt" TIMESTAMP(3),
    "status" "WholesaleOrderStatus" NOT NULL DEFAULT 'PENDING',
    "shiprocketOrderId" TEXT,
    "shiprocketShipmentId" TEXT,
    "awbCode" TEXT,
    "courierName" TEXT,
    "trackingUrl" TEXT,
    "shippingStatus" TEXT,
    "shippingSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleDesign" (
    "id" SERIAL NOT NULL,
    "wholesaleOrderId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleDesign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleOrder_reference_key" ON "WholesaleOrder"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleOrder_accessKey_key" ON "WholesaleOrder"("accessKey");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleOrder_razorpayOrderId_key" ON "WholesaleOrder"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "WholesaleOrder_status_idx" ON "WholesaleOrder"("status");

-- CreateIndex
CREATE INDEX "WholesaleOrder_contactEmail_idx" ON "WholesaleOrder"("contactEmail");

-- CreateIndex
CREATE INDEX "WholesaleOrder_userId_idx" ON "WholesaleOrder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleDesign_filePath_key" ON "WholesaleDesign"("filePath");

-- CreateIndex
CREATE INDEX "WholesaleDesign_wholesaleOrderId_idx" ON "WholesaleDesign"("wholesaleOrderId");

-- AddForeignKey
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleDesign" ADD CONSTRAINT "WholesaleDesign_wholesaleOrderId_fkey" FOREIGN KEY ("wholesaleOrderId") REFERENCES "WholesaleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
