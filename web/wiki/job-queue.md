# Job queue

DB-backed, one job at a time, worker is a child process.

## Why this shape

- **DB-backed**: on restart, `processing` jobs get reset to `pending` (`instrumentation.ts`). No in-memory state to lose.
- **One at a time**: the depth model is ~335 MB resident. Running two concurrent jobs risks OOM on small Railway instances.
- **Child process**: keeps the main Next.js server lean. When the worker exits, its RSS is reclaimed.

## Lifecycle

1. `POST /api/jobs` → insert `td_image { status: "pending" }`, call `jobQueue.kick()`
2. `kick()` checks if already processing; if not, forks `scripts/worker.js` with `{ jobId }`
3. Worker flips status to `processing`, starts work
4. On success → upload results, flip status to `done`
5. On error → flip status to `failed`, record error message
6. Worker exits. Queue loops to find next pending.

## Kick triggers

- API upload (new job inserted)
- Server startup (`instrumentation.ts` resets stuck + kicks)
- Manual: hitting any API endpoint that calls `jobQueue.kick()`

If a job was inserted directly via Prisma (e.g., from `scripts/create-pesach.js`) without calling the API, the queue **doesn't know about it**. Poking any `/api/*` endpoint or a server restart will pick it up. Known gotcha — don't insert jobs out-of-band without kicking.

## Reprocess / Rerun

- Cancelled jobs: user clicks **Reprocess** → status back to `pending`, kick the queue
- Done jobs: user clicks **Rerun** → same thing, regenerates with current settings

Both go through `POST /api/jobs/[id]` with `action: "reprocess"`.

## What NOT to do

- Don't scale Railway instances horizontally. Two instances would double-pick jobs. The queue assumes one worker.
- Don't increase worker concurrency. 335 MB × N → OOM.
- Don't run `prisma db push` — use `scripts/migrate.js` or `npm run db:push:prod`.
