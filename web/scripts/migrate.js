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
