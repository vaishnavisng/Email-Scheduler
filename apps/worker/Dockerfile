# Runs the worker process. Same coarse install as the api image.
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

CMD ["pnpm", "--filter", "@outbox/worker", "start"]
