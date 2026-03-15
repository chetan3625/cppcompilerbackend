# Use Node 22 base image and install g++ for C++ compilation
FROM node:22-bullseye

# Install g++ (needed by your /run endpoint) and clean up apt files
RUN apt-get update \
  && apt-get install -y g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files first so npm install can be cached
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
