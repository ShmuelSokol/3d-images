const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const statements = [
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS error TEXT`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "mediaType" TEXT NOT NULL DEFAULT 'image'`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "videoUrl" TEXT`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS duration FLOAT`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "frameCount" INT`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "framesDone" INT DEFAULT 0`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "colorMode" TEXT NOT NULL DEFAULT 'dubois'`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "fillOcclusion" BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "distanceMapUrl" TEXT`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "sessionId" TEXT`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "userId" TEXT`,
    `CREATE TABLE IF NOT EXISTS td_user (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_image_user') THEN
        ALTER TABLE td_image ADD CONSTRAINT fk_image_user FOREIGN KEY ("userId") REFERENCES td_user(id);
      END IF;
    END $$`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "stereogramUrl" TEXT`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "sbsUrl" TEXT`,
    // Credits & payments (2026-03-18)
    `ALTER TABLE td_user ADD COLUMN IF NOT EXISTS "imageCredits" INT NOT NULL DEFAULT 50`,
    `CREATE TABLE IF NOT EXISTS td_coupon (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      credits INT NOT NULL DEFAULT 100,
      "maxRedemptions" INT NOT NULL DEFAULT 1,
      "timesRedeemed" INT NOT NULL DEFAULT 0,
      "expiresAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS td_coupon_redemption (
      id TEXT PRIMARY KEY,
      "couponId" TEXT NOT NULL REFERENCES td_coupon(id),
      "userId" TEXT NOT NULL REFERENCES td_user(id),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE("couponId", "userId")
    )`,
    // Processing duration tracking (2026-03-18)
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3)`,
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS "processingMs" INT`,
    `CREATE TABLE IF NOT EXISTS td_payment (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES td_user(id),
      "stripeSessionId" TEXT UNIQUE NOT NULL,
      amount INT NOT NULL,
      credits INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    // Video format selection (2026-03-19)
    `ALTER TABLE td_image ADD COLUMN IF NOT EXISTS formats TEXT NOT NULL DEFAULT 'anaglyph,stereogram,sbs'`,
    // Support tickets (2026-03-18)
    `CREATE TABLE IF NOT EXISTS td_ticket (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      "userId" TEXT,
      "adminNote" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  for (const sql of statements) {
    console.log("Running:", sql.slice(0, 60) + "...");
    await prisma.$executeRawUnsafe(sql);
  }

  // Backfill: existing rows with results are done
  await prisma.$executeRawUnsafe(
    `UPDATE td_image SET status = 'done' WHERE "anaglyphUrl" IS NOT NULL AND status = 'pending'`
  );

  console.log("Migration complete!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
