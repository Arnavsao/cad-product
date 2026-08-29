# CADOnline API (NestJS + Prisma). Two stages: build with dev deps, run with
# production deps only. `prisma` stays in the runtime image because
# `start:prod` runs `prisma migrate deploy` before booting - migrations ship
# with the app rather than being a separate release step.

FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npx nest build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY --from=build /app/generated ./generated
COPY --from=build /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["npm", "run", "start:prod"]
