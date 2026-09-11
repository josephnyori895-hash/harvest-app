FROM node:22-alpine
RUN apk add --no-cache ffmpeg python3 make g++ vips-dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY . .
RUN addgroup -S harvest && adduser -S harvest -G harvest && chown -R harvest:harvest /app
USER harvest
EXPOSE 3000
CMD ["sh","-c","node src/migrate.js && node src/index.js"]
