# This needs be build from the root directory of this repo
# Install dependencies only when needed
FROM node:22-slim AS deps
WORKDIR /app
COPY ./package.json ./package-lock.json ./
RUN npm install --frozen-lockfile
WORKDIR /app/web
COPY ./web/package.json ./web/package-lock.json ./
RUN npm install --frozen-lockfile

# Rebuild the source code only when needed
FROM node:22-slim AS builder
ARG NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY ./ .
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY --from=deps /app/node_modules ./node_modules
WORKDIR /app/web
RUN npm run build

# Production image, copy all the files and run next
FROM node:22-slim AS runner
WORKDIR /app/web

ENV NODE_ENV production

# You only need to copy next.config.js if you are NOT using the default configuration
# COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/web/public ./public
COPY --from=builder /app/web/.next ./.next
COPY --from=builder /app/web/package.json ./package.json
COPY --from=builder /app/web/node_modules ./node_modules
#COPY --from=builder /app/node_modules ../node_modules
#COPY --from=builder /app/package.json ../package.json

RUN groupadd -g 1001 nodejs
RUN useradd -r -u 1001 -g nodejs nextjs
RUN chown -R nextjs:nodejs /app/web/.next
USER nextjs

EXPOSE 3000

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry.
# RUN npx next telemetry disable

CMD ["/bin/sh", "-c", "npm start"]
