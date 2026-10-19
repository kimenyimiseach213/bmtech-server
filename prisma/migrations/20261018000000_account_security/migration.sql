ALTER TABLE "AdminUser" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdminSession" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AdminEmailChange" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "currentEmail" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminEmailChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminEmailChange_adminId_key" ON "AdminEmailChange"("adminId");
CREATE UNIQUE INDEX "AdminEmailChange_tokenHash_key" ON "AdminEmailChange"("tokenHash");
ALTER TABLE "AdminEmailChange" ADD CONSTRAINT "AdminEmailChange_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuthRateLimit" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
