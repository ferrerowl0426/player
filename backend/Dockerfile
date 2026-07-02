FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p uploads/temp

EXPOSE 3000

CMD ["npm", "start"]
