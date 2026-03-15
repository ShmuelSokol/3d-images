# Use Debian slim (not Alpine) — onnxruntime-node needs glibc
FROM node:18-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ffmpeg && rm -rf /var/lib/apt/lists/*

# Dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL

RUN npx prisma@5 generate
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Writable cache dir for Transformers.js model downloads
ENV TRANSFORMERS_CACHE=/app/.cache
ENV HF_HOME=/app/.cache
ENV XDG_CACHE_HOME=/app/.cache

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create writable dirs
RUN mkdir -p /app/.cache /tmp/3d-jobs && chown nextjs:nodejs /app/.cache /tmp/3d-jobs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# Full node_modules for worker child process (avoids transitive dep issues)
COPY --from=builder /app/node_modules ./node_modules

# Worker script for child process job processing
COPY --from=builder /app/scripts/worker.js ./scripts/worker.js

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# More memory for large depth model (~335MB) + image processing
ENV NODE_OPTIONS="--max-old-space-size=1024"

CMD ["node", "server.js"]
