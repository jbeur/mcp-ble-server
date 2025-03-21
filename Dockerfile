FROM node:14

# Install system dependencies for BLE
RUN apt-get update && apt-get install -y \
    bluetooth \
    bluez \
    libbluetooth-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose port for API
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 