import { prisma } from "./prisma";
import { fork } from "child_process";
import { join } from "path";

class JobQueue {
  private running = false;

  /**
   * Kick the queue — process pending jobs one at a time in a child process.
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

        // Process in a child process so the main server stays responsive
        await this.runInChild(pending.id);
      }
    } catch (err) {
      console.error("[queue] Unexpected error:", err);
    } finally {
      this.running = false;
    }
  }

  private runInChild(jobId: string): Promise<void> {
    return new Promise((resolve) => {
      // Try multiple possible paths for the worker script
      const workerPath = join(process.cwd(), "scripts", "worker.js");

      const child = fork(workerPath, [], {
        env: { ...process.env },
        stdio: ["pipe", "inherit", "inherit", "ipc"],
      });

      let sent = false;

      child.on("message", (msg: { ready?: boolean }) => {
        if (msg.ready && !sent) {
          sent = true;
          child.send({ jobId });
        }
      });

      child.on("exit", () => {
        resolve();
      });

      child.on("error", (err) => {
        console.error(`[queue] Worker error for ${jobId}:`, err);
        resolve();
      });

      // Timeout: if worker doesn't finish in 4 hours, kill it
      setTimeout(() => {
        if (!child.killed) {
          console.error(`[queue] Worker timeout for ${jobId}, killing`);
          child.kill("SIGKILL");
        }
      }, 4 * 60 * 60 * 1000);
    });
  }
}

export const jobQueue = new JobQueue();
