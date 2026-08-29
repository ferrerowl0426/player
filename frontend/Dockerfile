FROM node:22-alpine

WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY package*.json ./
RUN npm ci

COPY . .
# 避免 Docker 层缓存导致 Next.js 使用旧的构建产物或页面缓存。
RUN rm -rf .next
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
