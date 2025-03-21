# MCP BLE Server

A robust and reliable Bluetooth Low Energy (BLE) server implementation for Node.js, designed to handle device discovery, connection management, and data communication with BLE devices.

## Features

- BLE device discovery and connection management
- WebSocket-based communication
- Authentication and session management
- Protocol message validation
- Performance monitoring and metrics

## Testing

The project includes a comprehensive test suite with the following components:

### Unit Tests
- Handler tests (Auth, Connection, Scan, Base)
- Protocol message validation tests
- Service tests (BLE, Auth, WebSocket)

### Performance Tests
- BLE service performance tests
  - Connection handling
  - Characteristic operations
  - Device discovery
- WebSocket server load tests
  - Concurrent connections
  - Message throughput
  - Connection cycling

### Security Tests
- Authentication security
- Message validation
- Connection security
- Rate limiting
- Flood protection

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit      # Unit tests only
npm run test:integration  # Integration tests only
npm run test:performance  # Performance tests only
npm run test:security   # Security tests only
npm run test:all       # Run all test suites

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Coverage

Current test coverage:
- Overall: 90.09%
- Protocol Messages: 100%
- Metrics: 100%
- Handler Factory: 100%
- Base Handler: 100%
- BLE Service: 80.27%
- Auth Service: 84.72%
- WebSocket Server: 81.69%

## Development

### Prerequisites

- Node.js >= 14.0.0
- npm or yarn
- BLE-capable device for testing

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm start
```

### Code Style

The project uses ESLint with Airbnb base configuration. To check and fix code style:

```bash
# Check code style
npm run lint

# Fix code style issues
npm run lint:fix
```

## License

MIT 