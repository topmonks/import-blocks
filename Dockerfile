FROM node:10-alpine

ADD package*.json ./
RUN npm install

ADD import-blocks.js .

ENTRYPOINT ["node", "import-blocks.js"]