# MCP BLE Server

A Model Context Protocol (MCP) server implementation that provides BLE (Bluetooth Low Energy) capabilities to AI assistants. It enables AI models to discover, connect to, and communicate with BLE devices through a standardized protocol interface.

## Features

- Reliable BLE device discovery and connection
- Robust error handling and recovery
- Comprehensive documentation
- High test coverage (>92%)
- MCP Protocol Implementation
- AI Assistant Integration
- Performance optimization
  - Memory pooling
  - Garbage collection tuning
  - Memory metrics tracking
  - Connection pooling
  - Message batching
  - Priority-based processing
- Security hardening (In Progress)
- Production deployment readiness (Planned)

## Technical Stack

- Node.js >= 14.x
- CommonJS modules
- Jest for testing
- Winston for logging
- Prometheus for metrics
- PM2 for process management
- WebSocket for MCP communication
- Protocol Buffers for message serialization

## Memory Management

The server implements advanced memory management features to optimize performance and resource usage:

### Memory Pooling

- Object pooling for frequently allocated types (buffers, strings, objects)
- Automatic pool size management based on usage patterns
- Priority-based pool allocation
- Memory reuse to reduce garbage collection pressure

### Garbage Collection Optimization

- Automatic garbage collection tuning
- Periodic memory usage monitoring
- Warning and critical thresholds for memory usage
- Proactive memory cleanup when thresholds are exceeded
- Memory usage metrics and analytics

### Memory Monitoring

- Real-time memory usage tracking
- Heap size monitoring
- Pool utilization metrics
- Garbage collection statistics
- Memory leak detection
- Resource usage alerts

## Project Structure

```
mcp-ble-server/
├── src/
│   ├── ble/           # BLE core functionality
│   ├── mcp/           # MCP protocol implementation
│   ├── config/        # Configuration management
│   ├── utils/         # Utility functions
│   └── index.js       # Application entry point
├── tests/
│   ├── unit/         # Unit tests
│   └── integration/  # Integration tests
├── docs/             # Documentation
└── config/           # Configuration files
```

## Configuration

### Memory Management Configuration

```javascript
{
  memoryMonitoring: {
    enabled: true,
    checkIntervalMS: 60000,        // Check memory usage every minute
    warningThresholdMB: 100,       // Warning at 100MB usage
    maxMemoryMB: 200,              // Maximum allowed memory usage
  },
  invalidationStrategy: {
    maxAge: 3600000,              // 1 hour
    maxSize: 1000,                // Maximum number of cached items
    priorityLevels: ['low', 'medium', 'high'],
    getPriorityValue: (priority) => {
      const values = { low: 0, medium: 1, high: 2 };
      return values[priority] || 0;
    }
  }
}
```

## Metrics

The server exposes various metrics for monitoring memory usage and performance:

- `memory_heap_size`: Current heap size in bytes
- `memory_heap_used`: Current heap usage in bytes
- `memory_heap_limit`: Heap size limit in bytes
- `memory_pool_size`: Current size of memory pools
- `memory_gc_count`: Number of garbage collections
- `memory_gc_duration`: Duration of garbage collections
- `memory_pool_hits`: Number of successful pool allocations
- `memory_pool_misses`: Number of failed pool allocations
- `cache_memory_usage`: Current cache memory usage
- `cache_memory_evictions`: Number of cache entries evicted

## Development

### Prerequisites

- Node.js >= 14.x
- npm or yarn
- Bluetooth adapter (for BLE functionality)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/mcp-ble-server.git

# Install dependencies
npm install

# Run tests
npm test

# Start the server
npm start
```

### Running with Memory Management

To enable memory management features, start the server with the `--expose-gc` flag:

```bash
node --expose-gc src/index.js
```

### Development Guidelines

1. Follow the CommonJS module format
2. Write comprehensive tests for new features
3. Update documentation for significant changes
4. Monitor memory usage during development
5. Use memory pooling for frequently allocated objects
6. Implement proper cleanup in error cases

## Testing

### Test Categories

1. **Unit Tests**
   - Located in `tests/unit/`
   - Test individual components in isolation
   - Use Jest for testing framework
   - Mock external dependencies

2. **Integration Tests**
   - Located in `tests/integration/`
   - Test component interactions
   - Test system behavior

3. **Performance Tests**
   - Located in `tests/performance/`
   - Test system under load
   - Measure response times
   - Monitor resource usage

4. **Security Tests**
   - Located in `tests/security/`
   - Test authentication
   - Test authorization
   - Test encryption

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/utils/Base64Utils.test.js

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch

# Run tests with verbose output
npm test -- --verbose
```

### Test Coverage

Current test coverage status:
- Base64Utils: 100% (22 passing tests)
  - Hardware acceleration tests
  - Encoding/decoding tests
  - Validation tests
  - Stream operation tests

### Memory Management Tests

```bash
# Run memory management tests
npm test -- tests/unit/utils/MemoryManager.test.js

# Run cache layer tests with memory management
npm test -- tests/unit/mcp/server/CachingLayer.test.js
```

## CI/CD Pipeline

The project uses GitHub Actions for continuous integration and deployment:

1. **Test Job**
   - Runs on Ubuntu
   - Installs Node.js
   - Runs all tests
   - Uploads coverage reports

2. **Lint Job**
   - Runs ESLint
   - Enforces code style
   - Checks for common issues

3. **Security Job**
   - Runs security audit
   - Checks dependencies
   - Generates security reports

4. **Build Job**
   - Builds the project
   - Verifies build output
   - Creates artifacts

5. **Deploy Job**
   - Deploys to staging
   - Requires approval
   - Monitors deployment

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details 