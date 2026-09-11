FROM node:20-alpine
RUN apk add --no-cache ffmpeg python3 make g++ vips-dev
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install
COPY . .
EXPOSE 3000
CMD ["node","src/index.js"]
