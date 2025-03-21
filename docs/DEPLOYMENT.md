# Deployment Guide

## Overview
This guide provides detailed instructions for deploying the MCP BLE Server in various environments, from development to production.

## Prerequisites

### Hardware Requirements
- Node.js >= 14.x
- Bluetooth adapter with BLE support
- Linux/macOS (Windows support coming soon)
- Minimum 1GB RAM
- 100MB free disk space

### Software Requirements
- npm >= 6.x
- Git
- System-level Bluetooth permissions
- sudo access (for Linux/macOS)

## Installation

### 1. Development Environment

```bash
# Clone the repository
git clone https://github.com/yourusername/mcp-ble-server.git
cd mcp-ble-server

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### 2. Production Environment

```bash
# Clone the repository
git clone https://github.com/yourusername/mcp-ble-server.git
cd mcp-ble-server

# Install production dependencies
npm ci --production

# Build the project
npm run build

# Create necessary directories
mkdir -p logs config
```

## Environment Setup

### 1. System Configuration

#### Linux
```bash
# Install required system packages
sudo apt-get update
sudo apt-get install bluetooth bluez

# Grant Bluetooth permissions
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

#### macOS
```bash
# Install required system packages
brew install bluetooth

# Grant Bluetooth permissions
sudo chown -R $(whoami) /Library/Preferences/com.apple.Bluetooth.plist
```

### 2. Environment Variables

Create a `.env` file in the project root:

```env
# Application
NODE_ENV=production
PORT=3000

# Logging
LOG_LEVEL=info
LOG_FILE=logs/app.log

# BLE Configuration
BLE_SCAN_DURATION=10
BLE_CONNECTION_TIMEOUT=5
BLE_AUTO_RECONNECT=true
BLE_RECONNECTION_ATTEMPTS=3
```

## Configuration Management

### 1. Default Configuration

Create `config/default.yaml`:

```yaml
ble:
  device_filters: []
  scan_duration: 10
  connection_timeout: 5
  auto_reconnect: true
  reconnection_attempts: 3
```

### 2. Production Configuration

Create `config/production.yaml`:

```yaml
ble:
  device_filters:
    - name: "ProductionDevice"
      alias: "prod-device"
  scan_duration: 15
  connection_timeout: 8
  auto_reconnect: true
  reconnection_attempts: 5
```

### 3. Configuration Validation

```bash
# Validate configuration
npm run validate-config
```

## Process Management

### 1. Using PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start ecosystem.config.js

# Monitor the application
pm2 monit

# View logs
pm2 logs mcp-ble-server
```

### 2. PM2 Configuration

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'mcp-ble-server',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
```

## Monitoring

### 1. Logging

#### Log Configuration
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}
```

### 2. Health Checks

Create `src/health.js`:

```javascript
const health = require('@cloudnative/health-connect');

const healthCheck = new health.HealthChecker();

healthCheck.registerReadinessCheck('ble', async () => {
  // Check BLE adapter status
  return true;
});

healthCheck.registerLivenessCheck('memory', async () => {
  const used = process.memoryUsage();
  return used.heapUsed < 500 * 1024 * 1024; // 500MB
});

module.exports = healthCheck;
```

### 3. Metrics Collection

```javascript
const prometheus = require('prom-client');

const collectDefaultMetrics = prometheus.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'mcp_ble_' });

const deviceCounter = new prometheus.Counter({
  name: 'mcp_ble_devices_total',
  help: 'Total number of discovered devices'
});

const connectionGauge = new prometheus.Gauge({
  name: 'mcp_ble_connected_devices',
  help: 'Number of currently connected devices'
});
```

## Backup and Recovery

### 1. Configuration Backup

```bash
# Backup configuration
cp config/production.yaml config/production.yaml.backup

# Restore configuration
cp config/production.yaml.backup config/production.yaml
```

### 2. Log Rotation

Configure log rotation in `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'mcp-ble-server',
    script: 'src/index.js',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    log_rotate: true,
    max_logs: '10d',
    // ... other options
  }]
};
```

## Security Considerations

### 1. File Permissions

```bash
# Set appropriate permissions
chmod 600 config/*.yaml
chmod 600 .env
chmod 755 logs
```

### 2. Network Security

```javascript
// Use HTTPS in production
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('path/to/key.pem'),
  cert: fs.readFileSync('path/to/cert.pem')
};

https.createServer(options, app).listen(443);
```

## Troubleshooting

### Common Issues

1. **Bluetooth Permissions**
   ```bash
   # Check Bluetooth status
   sudo systemctl status bluetooth
   
   # Restart Bluetooth service
   sudo systemctl restart bluetooth
   ```

2. **Memory Issues**
   ```bash
   # Monitor memory usage
   pm2 monit
   
   # Check for memory leaks
   node --expose-gc --trace-gc src/index.js
   ```

3. **Connection Problems**
   ```bash
   # Check BLE adapter
   hcitool dev
   
   # Scan for devices
   hcitool lescan
   ```

### Log Analysis

```bash
# View error logs
tail -f logs/error.log

# Search for specific errors
grep "ERROR" logs/combined.log

# Analyze log patterns
cat logs/combined.log | awk '{print $4}' | sort | uniq -c
```

## Scaling Considerations

### 1. Horizontal Scaling

```javascript
// Use Redis for device state sharing
const Redis = require('ioredis');
const redis = new Redis();

// Store device state
await redis.set(`device:${deviceId}`, JSON.stringify(deviceState));
```

### 2. Load Balancing

```javascript
// Use cluster module for load balancing
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
} else {
  // Worker process
  require('./src/index.js');
}
```

## Maintenance

### 1. Regular Tasks

```bash
# Update dependencies
npm update

# Run security audit
npm audit

# Clean up logs
pm2 flush

# Restart application
pm2 restart mcp-ble-server
```

### 2. Backup Schedule

```bash
# Daily configuration backup
0 0 * * * cp config/production.yaml config/production.yaml.$(date +%Y%m%d)

# Weekly log archive
0 0 * * 0 tar -czf logs/archive_$(date +%Y%m%d).tar.gz logs/*.log
``` 