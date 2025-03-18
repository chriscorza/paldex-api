# Usa la última imagen base de Node.js 20 en Alpine para reducir el tamaño
FROM node:20.17-alpine

# Establece el directorio de trabajo en el contenedor
WORKDIR /app

# Copia los archivos de package.json y package-lock.json
COPY package*.json ./

# Instala las dependencias de la aplicación
RUN npm install --production

# # Copia el resto de los archivos de la aplicación al contenedor
# COPY . .

# # Compila el proyecto TypeScript
# RUN npm run build

# Expone el puerto 3000
EXPOSE 3000

# Comando para iniciar la aplicación en modo producción
CMD ["npm", "run", "start:dev"]