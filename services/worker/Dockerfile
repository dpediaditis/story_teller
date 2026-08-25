FROM node:20-slim AS base
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/worker/package.json services/worker/package.json
RUN pnpm install --frozen-lockfile --filter @papercub/worker...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY services/worker services/worker
RUN pnpm --filter @papercub/worker run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/services/worker/dist ./services/worker/dist
COPY --from=build /app/services/worker/package.json ./services/worker/package.json
WORKDIR /app/services/worker
CMD ["node", "dist/index.js"]
