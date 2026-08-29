# Runs the Next.js dashboard in dev mode (scaffold — no production build yet).
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

EXPOSE 3000
CMD ["pnpm", "--filter", "@outbox/web", "dev"]
