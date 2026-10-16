CREATE TYPE "ProductCondition" AS ENUM ('NEW', 'USED');
CREATE TYPE "PriceMode" AS ENUM ('FIXED', 'QUOTE_REQUIRED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'FULFILLED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILED', 'REFUNDED');
CREATE TYPE "FulfillmentMethod" AS ENUM ('DELIVERY', 'COLLECTION');
CREATE TYPE "QuoteStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'REJECTED', 'CLOSED');
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'APPROVED', 'RESCHEDULED', 'REJECTED', 'COMPLETED');
CREATE TYPE "MessageStatus" AS ENUM ('UNREAD', 'READ', 'HANDLED');
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'HIDDEN');

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminSession" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameFr" TEXT NOT NULL,
  "descriptionEn" TEXT NOT NULL DEFAULT '',
  "descriptionFr" TEXT NOT NULL DEFAULT '',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sku" TEXT,
  "categoryId" TEXT NOT NULL,
  "brand" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "nameEn" TEXT NOT NULL,
  "nameFr" TEXT NOT NULL,
  "descriptionEn" TEXT NOT NULL DEFAULT '',
  "descriptionFr" TEXT NOT NULL DEFAULT '',
  "condition" "ProductCondition" NOT NULL DEFAULT 'NEW',
  "priceMode" "PriceMode" NOT NULL DEFAULT 'FIXED',
  "price" DECIMAL(12,2),
  "stockQuantity" INTEGER NOT NULL DEFAULT 0,
  "installationAvailable" BOOLEAN NOT NULL DEFAULT false,
  "isPublished" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductImage" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "alt" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isCover" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "clientReference" TEXT,
  "customerName" TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  "customerEmail" TEXT,
  "fulfillment" "FulfillmentMethod" NOT NULL,
  "deliveryAddress" TEXT,
  "notes" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "total" DECIMAL(12,2) NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "productId" TEXT,
  "productSlug" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT '',
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "lineTotal" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'MANUAL',
  "amount" DECIMAL(12,2) NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationRequest" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "productOrService" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "contactMethod" TEXT NOT NULL DEFAULT 'WhatsApp',
  "details" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "status" "QuoteStatus" NOT NULL DEFAULT 'OPEN',
  "quotedAmount" DECIMAL(12,2),
  "adminNotes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuotationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TechnicianBooking" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "service" TEXT NOT NULL,
  "preferredDate" TIMESTAMP(3) NOT NULL,
  "preferredTime" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledAt" TIMESTAMP(3),
  "adminNotes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TechnicianBooking_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactMessage" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "message" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "status" "MessageStatus" NOT NULL DEFAULT 'UNREAD',
  "adminNotes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Review" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "experience" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "adminNotes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanySettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "companyName" TEXT NOT NULL DEFAULT 'BMTECH',
  "phone" TEXT NOT NULL DEFAULT '0788494513',
  "whatsapp" TEXT NOT NULL DEFAULT '250788494513',
  "email" TEXT NOT NULL DEFAULT '',
  "businessHours" TEXT NOT NULL DEFAULT '',
  "aboutEn" TEXT NOT NULL DEFAULT '',
  "aboutFr" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE INDEX "AdminSession_adminId_expiresAt_idx" ON "AdminSession"("adminId", "expiresAt");
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE INDEX "Product_categoryId_isPublished_idx" ON "Product"("categoryId", "isPublished");
CREATE INDEX "Product_nameEn_nameFr_idx" ON "Product"("nameEn", "nameFr");
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");
CREATE UNIQUE INDEX "Order_clientReference_key" ON "Order"("clientReference");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Order_paymentStatus_createdAt_idx" ON "Order"("paymentStatus", "createdAt");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");
CREATE UNIQUE INDEX "QuotationRequest_reference_key" ON "QuotationRequest"("reference");
CREATE INDEX "QuotationRequest_status_createdAt_idx" ON "QuotationRequest"("status", "createdAt");
CREATE UNIQUE INDEX "TechnicianBooking_reference_key" ON "TechnicianBooking"("reference");
CREATE INDEX "TechnicianBooking_status_preferredDate_idx" ON "TechnicianBooking"("status", "preferredDate");
CREATE UNIQUE INDEX "ContactMessage_reference_key" ON "ContactMessage"("reference");
CREATE INDEX "ContactMessage_status_createdAt_idx" ON "ContactMessage"("status", "createdAt");
CREATE UNIQUE INDEX "Review_reference_key" ON "Review"("reference");
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_createdAt_idx" ON "AuditLog"("entity", "entityId", "createdAt");

ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
