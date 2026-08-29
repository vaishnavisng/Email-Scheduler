# Runs the API (and, with a command override in compose, the migrate step).
# Dev-runtime image: source runs through tsx, no separate build step yet.
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

# .dockerignore keeps node_modules/dist out; copy the whole workspace and
# install once so workspace deps resolve. Layer caching is coarse here —
# acceptable for a scaffold, tighten if image build time bites.
COPY . .
RUN pnpm install --frozen-lockfile

EXPOSE 4000
CMD ["pnpm", "--filter", "@outbox/api", "start"]
