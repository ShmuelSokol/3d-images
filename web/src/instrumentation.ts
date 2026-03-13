export async function register() {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { prisma } = await import("@/lib/prisma");

    // Reset any jobs stuck in "processing" from a previous crash/deploy
    const stuck = await prisma.image.updateMany({
      where: { status: "processing" },
      data: { status: "pending" },
    });
    if (stuck.count > 0) {
      console.log(`[startup] Reset ${stuck.count} stuck jobs to pending`);
    }

    // Kick the queue in case there are pending jobs
    const { jobQueue } = await import("@/lib/job-queue");
    jobQueue.kick().catch(console.error);
  }
}
