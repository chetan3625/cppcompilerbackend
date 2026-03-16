# Use Node 22 base image and install g++ + JDK for compilation
FROM node:22-bullseye

# Install compilers/interpreters needed by your /run endpoint (C/C++/Java/Python), then clean up apt files
RUN apt-get update \
  && apt-get install -y build-essential openjdk-17-jdk-headless python3 libsqlite3-dev sqlite3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files first so npm install can be cached
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
