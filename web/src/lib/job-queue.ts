import { prisma } from "./prisma";
import { fork, ChildProcess } from "child_process";
import { join } from "path";

class JobQueue {
  private running = false;
  private currentChild: ChildProcess | null = null;
  private currentJobId: string | null = null;

  constructor() {
    // Graceful shutdown: on SIGTERM (Railway sends this before killing),
    // mark current job as pending so it resumes on next deploy
    const shutdown = async (signal: string) => {
      console.log(`[queue] Received ${signal}, shutting down gracefully...`);

      if (this.currentChild && !this.currentChild.killed) {
        console.log(`[queue] Sending SIGTERM to worker (job ${this.currentJobId})`);
        this.currentChild.kill("SIGTERM");

        // Give worker 5 seconds to finish current frame and save progress
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5000);
          this.currentChild?.on("exit", () => { clearTimeout(timeout); resolve(); });
        });
      }

      // Mark any processing jobs back to pending (preserves framesDone)
      if (this.currentJobId) {
        try {
          await prisma.image.update({
            where: { id: this.currentJobId },
            data: { status: "pending" },
          });
          console.log(`[queue] Marked job ${this.currentJobId} as pending for resume`);
        } catch (err) {
          console.error(`[queue] Failed to mark job as pending:`, err);
        }
      }

      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }

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

        // Mark as processing with start time (only if fresh start, not resume)
        const updateData: Record<string, unknown> = { status: "processing" };
        if (!pending.startedAt) {
          updateData.startedAt = new Date();
        }

        await prisma.image.update({
          where: { id: pending.id },
          data: updateData,
        });

        this.currentJobId = pending.id;

        // Process in a child process so the main server stays responsive
        await this.runInChild(pending.id);

        this.currentChild = null;
        this.currentJobId = null;
      }
    } catch (err) {
      console.error("[queue] Unexpected error:", err);
    } finally {
      this.running = false;
      this.currentChild = null;
      this.currentJobId = null;
    }
  }

  private runInChild(jobId: string): Promise<void> {
    return new Promise((resolve) => {
      const workerPath = join(process.cwd(), "scripts", "worker.js");

      const child = fork(workerPath, [], {
        env: { ...process.env },
        stdio: ["pipe", "inherit", "inherit", "ipc"],
      });

      this.currentChild = child;

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

      // Timeout: if worker doesn't finish in 6 hours, kill it
      setTimeout(() => {
        if (!child.killed) {
          console.error(`[queue] Worker timeout for ${jobId}, killing`);
          child.kill("SIGKILL");
        }
      }, 6 * 60 * 60 * 1000);
    });
  }
}

export const jobQueue = new JobQueue();
