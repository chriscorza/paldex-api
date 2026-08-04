# syntax=docker/dockerfile:1

##############################################
# Etapa 1 — development
# Dependencias completas (incluye devDependencies).
# La usa docker-compose para el modo watch local.
##############################################
FROM node:22-alpine AS development

WORKDIR /app

# openssl lo necesitan los engines de Prisma en Alpine
RUN apk add --no-cache openssl

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma

RUN npm ci

COPY . .

# prisma.config.ts exige DATABASE_URL para cargarse, aunque `generate` no se
# conecte a nada. Se pasa inline (solo para este RUN) para que NO quede grabada
# en la imagen: en runtime la real la inyecta Coolify.
RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate

EXPOSE 3000
CMD ["npm", "run", "start:dev"]

##############################################
# Etapa 2 — builder
# Compila TypeScript a dist/.
##############################################
FROM development AS builder

RUN npm run build

##############################################
# Etapa 3 — production (imagen final)
# Solo dependencias de runtime + dist compilado.
##############################################
FROM node:22-alpine AS production

# curl es para el healthcheck de Coolify (docker exec ... curl http://localhost:3000/health).
# El wget de BusyBox que trae Alpine por defecto no basta para lo que Coolify ejecuta.
RUN apk add --no-cache openssl curl

ENV NODE_ENV=production

COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Se cambia a usuario `node` ANTES de instalar dependencias. Hacerlo al final
# con `chown -R` obligaría a Docker a duplicar toda la capa de node_modules,
# y la imagen crecería más del doble.
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package*.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma

# --omit=dev deja fuera nest-cli, jest, eslint, etc.
# El CLI de prisma y dotenv están en "dependencies" a propósito:
# hacen falta para `prisma migrate deploy` en el arranque del contenedor.
RUN npm ci --omit=dev && npm cache clean --force

# prisma.config.ts exige DATABASE_URL para cargarse, aunque `generate` no se
# conecte a nada. Se pasa inline (solo para este RUN) para que NO quede grabada
# en la imagen: en runtime la real la inyecta Coolify.
RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate

COPY --from=builder --chown=node:node /app/dist ./dist

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"]
