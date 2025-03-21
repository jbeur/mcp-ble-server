# Performance Optimization Guide

## Overview
This guide provides comprehensive information about optimizing the performance of the MCP BLE Server, including metrics, techniques, tools, and best practices.

## Performance Metrics

### 1. Key Metrics

#### Device Discovery
```javascript
const metrics = {
  discoveryTime: new prometheus.Histogram({
    name: 'ble_discovery_time_seconds',
    help: 'Time taken to discover devices',
    buckets: [0.1, 0.5, 1, 2, 5]
  }),
  
  devicesFound: new prometheus.Counter({
    name: 'ble_devices_found_total',
    help: 'Total number of devices discovered'
  })
};
```

#### Connection Performance
```javascript
const metrics = {
  connectionTime: new prometheus.Histogram({
    name: 'ble_connection_time_seconds',
    help: 'Time taken to connect to devices',
    buckets: [0.1, 0.5, 1, 2, 5]
  }),
  
  connectionSuccess: new prometheus.Counter({
    name: 'ble_connection_success_total',
    help: 'Total number of successful connections'
  }),
  
  connectionFailure: new prometheus.Counter({
    name: 'ble_connection_failure_total',
    help: 'Total number of failed connections'
  })
};
```

#### Data Transfer
```javascript
const metrics = {
  transferRate: new prometheus.Gauge({
    name: 'ble_transfer_rate_bytes_per_second',
    help: 'Current data transfer rate'
  }),
  
  transferLatency: new prometheus.Histogram({
    name: 'ble_transfer_latency_seconds',
    help: 'Data transfer latency',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1]
  })
};
```

### 2. Resource Usage
```javascript
const metrics = {
  memoryUsage: new prometheus.Gauge({
    name: 'ble_memory_usage_bytes',
    help: 'Current memory usage'
  }),
  
  cpuUsage: new prometheus.Gauge({
    name: 'ble_cpu_usage_percent',
    help: 'Current CPU usage percentage'
  }),
  
  eventLoopLag: new prometheus.Gauge({
    name: 'ble_event_loop_lag_seconds',
    help: 'Event loop lag'
  })
};
```

## Optimization Techniques

### 1. Device Discovery Optimization

#### Parallel Scanning
```javascript
class BLEService {
  constructor() {
    this.scanQueue = new Queue();
    this.maxConcurrentScans = 3;
  }

  async startScanning() {
    while (this.scanQueue.size() > 0) {
      const batch = this.scanQueue.take(this.maxConcurrentScans);
      await Promise.all(batch.map(device => this.scanDevice(device)));
    }
  }

  async scanDevice(device) {
    const startTime = Date.now();
    try {
      await this.performScan(device);
      metrics.discoveryTime.observe((Date.now() - startTime) / 1000);
    } catch (error) {
      logger.error('Scan failed', { deviceId: device.id, error });
    }
  }
}
```

#### Scan Duration Optimization
```javascript
function optimizeScanDuration(deviceCount) {
  // Adjust scan duration based on device count
  const baseDuration = 10;
  const deviceFactor = Math.min(deviceCount / 10, 2);
  return baseDuration * deviceFactor;
}
```

### 2. Connection Optimization

#### Connection Pooling
```javascript
class ConnectionPool {
  constructor(maxSize = 5) {
    this.pool = new Map();
    this.maxSize = maxSize;
  }

  async getConnection(deviceId) {
    if (this.pool.has(deviceId)) {
      return this.pool.get(deviceId);
    }

    if (this.pool.size >= this.maxSize) {
      await this.releaseOldestConnection();
    }

    const connection = await this.createConnection(deviceId);
    this.pool.set(deviceId, connection);
    return connection;
  }

  async releaseOldestConnection() {
    const oldest = Array.from(this.pool.entries())
      .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)[0];
    if (oldest) {
      await this.disconnect(oldest[0]);
      this.pool.delete(oldest[0]);
    }
  }
}
```

#### Connection Retry Strategy
```javascript
async function connectWithRetry(device, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 5000
  } = options;

  let delay = initialDelay;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const startTime = Date.now();
      await connectToDevice(device);
      metrics.connectionTime.observe((Date.now() - startTime) / 1000);
      metrics.connectionSuccess.inc();
      return true;
    } catch (error) {
      if (attempt === maxAttempts) {
        metrics.connectionFailure.inc();
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelay);
    }
  }
}
```

### 3. Data Transfer Optimization

#### Chunked Data Transfer
```javascript
class DataTransfer {
  constructor(chunkSize = 512) {
    this.chunkSize = chunkSize;
  }

  async transferData(data, characteristic) {
    const chunks = this.splitIntoChunks(data);
    const startTime = Date.now();
    let totalBytes = 0;

    for (const chunk of chunks) {
      await this.writeChunk(chunk, characteristic);
      totalBytes += chunk.length;
      
      const duration = (Date.now() - startTime) / 1000;
      const rate = totalBytes / duration;
      metrics.transferRate.set(rate);
    }
  }

  splitIntoChunks(data) {
    const chunks = [];
    for (let i = 0; i < data.length; i += this.chunkSize) {
      chunks.push(data.slice(i, i + this.chunkSize));
    }
    return chunks;
  }
}
```

#### MTU Optimization
```javascript
async function optimizeMTU(device) {
  const mtuSizes = [23, 185, 244, 247];
  let bestMTU = 23;

  for (const mtu of mtuSizes) {
    try {
      await device.requestMTU(mtu);
      const throughput = await measureThroughput(device, mtu);
      if (throughput > bestThroughput) {
        bestMTU = mtu;
        bestThroughput = throughput;
      }
    } catch (error) {
      logger.warn('MTU request failed', { mtu, error });
    }
  }

  return bestMTU;
}
```

### 4. Memory Optimization

#### Resource Cleanup
```javascript
class ResourceManager {
  constructor() {
    this.resources = new Map();
    this.cleanupInterval = 60000; // 1 minute
  }

  startCleanup() {
    setInterval(() => this.cleanup(), this.cleanupInterval);
  }

  async cleanup() {
    const now = Date.now();
    for (const [id, resource] of this.resources) {
      if (now - resource.lastUsed > resource.timeout) {
        await this.releaseResource(id);
      }
    }
  }

  async releaseResource(id) {
    const resource = this.resources.get(id);
    if (resource) {
      await resource.dispose();
      this.resources.delete(id);
    }
  }
}
```

#### Event Listener Management
```javascript
class EventManager {
  constructor() {
    this.listeners = new Map();
  }

  addListener(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(listener);
  }

  removeListener(event, listener) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  cleanup() {
    this.listeners.clear();
  }
}
```

## Monitoring Tools

### 1. Performance Monitoring
```javascript
const monitoring = {
  startMonitoring() {
    // Monitor event loop lag
    setInterval(() => {
      const start = process.hrtime();
      setImmediate(() => {
        const [seconds, nanoseconds] = process.hrtime(start);
        metrics.eventLoopLag.set(seconds + nanoseconds / 1e9);
      });
    }, 1000);

    // Monitor memory usage
    setInterval(() => {
      const usage = process.memoryUsage();
      metrics.memoryUsage.set(usage.heapUsed);
    }, 1000);

    // Monitor CPU usage
    setInterval(() => {
      const startUsage = process.cpuUsage();
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const total = endUsage.user + endUsage.system;
        metrics.cpuUsage.set(total / 1000000); // Convert to percentage
      }, 100);
    }, 1000);
  }
};
```

### 2. Performance Profiling
```javascript
const profiler = {
  async profileOperation(operation, name) {
    const start = process.hrtime();
    try {
      return await operation();
    } finally {
      const [seconds, nanoseconds] = process.hrtime(start);
      const duration = seconds + nanoseconds / 1e9;
      logger.info('Operation profile', {
        name,
        duration,
        timestamp: new Date()
      });
    }
  }
};
```

## Benchmarking

### 1. Benchmark Suite
```javascript
const benchmark = {
  async runDiscoveryBenchmark() {
    const results = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await bleService.startScanning();
      const duration = Date.now() - start;
      results.push(duration);
    }
    return this.calculateStats(results);
  },

  async runConnectionBenchmark() {
    const results = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await bleService.connectToDevice(testDevice);
      const duration = Date.now() - start;
      results.push(duration);
    }
    return this.calculateStats(results);
  },

  calculateStats(results) {
    const sum = results.reduce((a, b) => a + b, 0);
    const avg = sum / results.length;
    const min = Math.min(...results);
    const max = Math.max(...results);
    return { avg, min, max };
  }
};
```

### 2. Load Testing
```javascript
const loadTest = {
  async runLoadTest(options) {
    const {
      deviceCount = 10,
      operationCount = 100,
      concurrentOperations = 5
    } = options;

    const devices = Array(deviceCount).fill().map((_, i) => ({
      id: `device-${i}`,
      name: `Test Device ${i}`
    }));

    const operations = Array(operationCount).fill().map(() => ({
      device: devices[Math.floor(Math.random() * devices.length)],
      operation: Math.random() > 0.5 ? 'read' : 'write'
    }));

    const batches = this.createBatches(operations, concurrentOperations);
    const results = [];

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(op => this.executeOperation(op))
      );
      results.push(...batchResults);
    }

    return this.analyzeResults(results);
  }
};
```

## Performance Checklist

### 1. Development
- [ ] Implement performance metrics
- [ ] Optimize device discovery
- [ ] Implement connection pooling
- [ ] Optimize data transfer
- [ ] Manage memory usage
- [ ] Handle event listeners
- [ ] Implement retry strategies
- [ ] Add performance monitoring
- [ ] Create benchmark suite
- [ ] Perform load testing

### 2. Deployment
- [ ] Configure monitoring
- [ ] Set up alerts
- [ ] Configure logging
- [ ] Set resource limits
- [ ] Enable profiling
- [ ] Configure caching
- [ ] Set up load balancing
- [ ] Monitor system resources

### 3. Maintenance
- [ ] Regular performance testing
- [ ] Monitor metrics
- [ ] Analyze bottlenecks
- [ ] Update optimizations
- [ ] Review resource usage
- [ ] Clean up resources
- [ ] Update benchmarks
- [ ] Document changes

## Resources

### Performance Tools
- [Node.js Profiler](https://nodejs.org/en/docs/guides/simple-profiling/)
- [clinic.js](https://clinicjs.org/)
- [0x](https://github.com/davidmarkclements/0x)

### Performance Documentation
- [Node.js Performance](https://nodejs.org/en/docs/guides/performance/)
- [V8 Engine](https://v8.dev/)
- [Bluetooth Performance](https://www.bluetooth.com/develop-with-bluetooth/performance/) 