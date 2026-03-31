# Use Node.js 24 as the base image
FROM node:24-slim

# Install system dependencies for Puppeteer (Chromium)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    git \
    zip \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create and set the working directory
WORKDIR /app

# Clone the repository
RUN git clone https://github.com/AmmarBasha2011/AmmarClaw.git .

# Install dependencies
RUN npm install

# Build the project
RUN npm run build

# Expose the health check port
EXPOSE 8000

# Start the application
CMD ["npm", "start"]
