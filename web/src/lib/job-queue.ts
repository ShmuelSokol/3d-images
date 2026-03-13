import { prisma } from "./prisma";
import { processJob } from "./job-processor";

class JobQueue {
  private running = false;

  /**
   * Kick the queue — process pending jobs one at a time.
   * Safe to call multiple times; only one loop runs at a time.
   */
  async kick() {
    if (this.running) return;
    this.running = true;

    try {
      while (true) {
        // Claim next pending job (oldest first)
        const pending = await prisma.image.findFirst({
          where: { status: "pending" },
          orderBy: { createdAt: "asc" },
        });

        if (!pending) break;

        // Re-check status (may have been cancelled while pending)
        const fresh = await prisma.image.findUnique({ where: { id: pending.id }, select: { status: true } });
        if (fresh?.status !== "pending") continue;

        // Mark as processing
        await prisma.image.update({
          where: { id: pending.id },
          data: { status: "processing" },
        });

        // Process it
        await processJob(pending.id);
      }
    } catch (err) {
      console.error("[queue] Unexpected error:", err);
    } finally {
      this.running = false;
    }
  }
}

export const jobQueue = new JobQueue();
