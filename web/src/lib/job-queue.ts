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

        // Deliberately keep `currentChild`: the worker stays warm for the next
        // job so the depth model isn't reloaded. Clearing it here would orphan
        // a live process and fork a second one on the next job.
        this.currentJobId = null;
      }
    } catch (err) {
      console.error("[queue] Unexpected error:", err);
    } finally {
      this.running = false;
      this.currentJobId = null;
      // `currentChild` is intentionally left alive between drains — see above.
    }
  }

  /**
   * Get a warm worker, starting one if needed.
   *
   * The worker used to be forked per job and exit when done, which meant every
   * single job reloaded the ~1GB depth model from scratch (and re-downloaded it
   * whenever the container had restarted, since the cache dir is ephemeral).
   * One long-lived worker loads it once and renders every job after that.
   */
  private async getWorker(): Promise<ChildProcess> {
    if (this.currentChild && !this.currentChild.killed && this.currentChild.connected) {
      return this.currentChild;
    }

    const workerPath = join(process.cwd(), "scripts", "worker.js");
    const child = fork(workerPath, [], {
      env: { ...process.env },
      stdio: ["pipe", "inherit", "inherit", "ipc"],
    });
    this.currentChild = child;

    // A worker that dies (crash, OOM, SIGTERM) must not be reused.
    const drop = () => {
      if (this.currentChild === child) this.currentChild = null;
    };
    child.on("exit", drop);
    child.on("error", (err) => {
      console.error("[queue] Worker error:", err);
      drop();
    });

    await new Promise<void>((resolve) => {
      const onReady = (msg: { ready?: boolean }) => {
        if (msg?.ready) {
          child.off("message", onReady);
          resolve();
        }
      };
      child.on("message", onReady);
      // If it dies before signalling ready, don't hang the queue forever.
      child.once("exit", () => resolve());
    });

    return child;
  }

  private async runInChild(jobId: string): Promise<void> {
    const child = await this.getWorker();
    if (!child.connected) {
      console.error(`[queue] Worker unavailable for ${jobId}`);
      return;
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        child.off("message", onMessage);
        child.off("exit", onExit);
        clearTimeout(timer);
        resolve();
      };

      const onMessage = (msg: { done?: boolean; jobId?: string }) => {
        if (msg?.done && msg.jobId === jobId) finish();
      };
      // A crash mid-job still has to release the queue.
      const onExit = () => {
        if (this.currentChild === child) this.currentChild = null;
        finish();
      };

      child.on("message", onMessage);
      child.on("exit", onExit);

      // Timeout: if the worker doesn't finish in 6 hours, kill it
      const timer = setTimeout(() => {
        if (!child.killed) {
          console.error(`[queue] Worker timeout for ${jobId}, killing`);
          child.kill("SIGKILL");
        }
        if (this.currentChild === child) this.currentChild = null;
        finish();
      }, 6 * 60 * 60 * 1000);

      child.send({ jobId });
    });
  }

}

export const jobQueue = new JobQueue();
