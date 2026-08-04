#!/bin/sh
set -e

# Aplica las migraciones pendientes antes de levantar la app.
#
# `migrate deploy` no genera migraciones ni pide confirmación: solo aplica las
# que ya están en prisma/migrations. Es el comando correcto para producción.
#
# Se reintenta porque el contenedor del API puede arrancar antes de que MySQL
# acepte conexiones (arranque en frío del stack, o reinicio de la base de datos
# en Coolify). Sin esto, el primer despliegue falla de forma intermitente.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  MAX_ATTEMPTS="${MIGRATION_MAX_ATTEMPTS:-30}"
  attempt=1

  while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
    echo "==> Aplicando migraciones de Prisma (intento $attempt/$MAX_ATTEMPTS)..."

    if npx prisma migrate deploy; then
      echo "==> Migraciones al día."
      break
    fi

    if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
      echo "!!! La base de datos sigue sin responder tras $MAX_ATTEMPTS intentos. Abortando." >&2
      exit 1
    fi

    echo "    Base de datos no disponible todavía, reintentando en 2s..."
    attempt=$((attempt + 1))
    sleep 2
  done
else
  echo "==> RUN_MIGRATIONS=false, se omiten las migraciones."
fi

exec "$@"
