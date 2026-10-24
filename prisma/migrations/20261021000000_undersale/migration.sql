-- Additive migration; no existing records or contacts are changed.
ALTER TYPE "ProductCondition" ADD VALUE IF NOT EXISTS 'REFURBISHED';
ALTER TABLE "Product" ADD COLUMN "isUndersale" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "shortDescription" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "specifications" JSONB NOT NULL DEFAULT '[]',
 ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompanySettings" ADD COLUMN "ceoWhatsapp" TEXT NOT NULL DEFAULT '';
