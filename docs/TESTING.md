# Testing Guide

## Overview
This guide provides comprehensive information about testing the MCP BLE Server, including unit tests, integration tests, and best practices for writing and maintaining tests.

## Test Structure

### Directory Structure
```
tests/
├── ble/
│   ├── bleService.test.js
│   └── bleUtils.test.js
├── config/
│   └── configLoader.test.js
└── utils/
    └── bleErrors.test.js
```

### Test Categories

#### 1. Unit Tests
- Test individual components in isolation
- Mock external dependencies
- Focus on specific functionality

#### 2. Integration Tests
- Test component interactions
- Use real BLE devices when possible
- Test end-to-end workflows

## Writing Tests

### Test Setup

#### Basic Test Structure
```javascript
const { BLEService } = require('../../src/ble/bleService');
const { BLEError } = require('../../src/utils/bleErrors');

describe('BLEService', () => {
  let bleService;

  beforeEach(() => {
    bleService = new BLEService();
  });

  afterEach(() => {
    bleService.cleanup();
  });

  // Test cases...
});
```

#### Mocking Dependencies
```javascript
jest.mock('@abandonware/noble', () => ({
  startScanningAsync: jest.fn(),
  stopScanningAsync: jest.fn(),
  connectAsync: jest.fn(),
  disconnectAsync: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn()
}));
```

### Test Cases

#### 1. Initialization Tests
```javascript
describe('Initialization', () => {
  test('should initialize with default settings', () => {
    expect(bleService.isInitialized).toBe(false);
    expect(bleService.isScanning).toBe(false);
    expect(bleService.connectedDevices).toEqual(new Map());
  });

  test('should initialize with custom settings', () => {
    const customConfig = {
      scan_duration: 15,
      connection_timeout: 10
    };
    const service = new BLEService(customConfig);
    expect(service.config).toEqual(expect.objectContaining(customConfig));
  });
});
```

#### 2. Device Discovery Tests
```javascript
describe('Device Discovery', () => {
  test('should discover devices', async () => {
    const mockDevice = {
      id: 'device1',
      name: 'TestDevice',
      address: '00:11:22:33:44:55'
    };

    noble.startScanningAsync.mockResolvedValue();
    noble.on.mockImplementation((event, callback) => {
      if (event === 'discover') {
        callback(mockDevice);
      }
    });

    await bleService.startScanning();
    expect(bleService.discoveredDevices.has(mockDevice.id)).toBe(true);
  });

  test('should handle scanning errors', async () => {
    noble.startScanningAsync.mockRejectedValue(new Error('Scan failed'));
    
    await expect(bleService.startScanning()).rejects.toThrow(BLEScanError);
  });
});
```

#### 3. Connection Tests
```javascript
describe('Device Connection', () => {
  test('should connect to device', async () => {
    const mockDevice = {
      id: 'device1',
      name: 'TestDevice'
    };

    noble.connectAsync.mockResolvedValue();
    
    await bleService.connectToDevice(mockDevice);
    expect(bleService.connectedDevices.has(mockDevice.id)).toBe(true);
  });

  test('should handle connection timeout', async () => {
    const mockDevice = {
      id: 'device1',
      name: 'TestDevice'
    };

    noble.connectAsync.mockImplementation(() => 
      new Promise(resolve => setTimeout(resolve, 6000))
    );

    await expect(bleService.connectToDevice(mockDevice))
      .rejects.toThrow(BLEConnectionError);
  });
});
```

#### 4. Error Handling Tests
```javascript
describe('Error Handling', () => {
  test('should handle device not found', async () => {
    const nonExistentDevice = {
      id: 'nonexistent',
      name: 'NonExistent'
    };

    await expect(bleService.connectToDevice(nonExistentDevice))
      .rejects.toThrow(BLEDeviceError);
  });

  test('should handle scanning errors with retry', async () => {
    noble.startScanningAsync
      .mockRejectedValueOnce(new Error('First attempt failed'))
      .mockResolvedValueOnce();

    await bleService.startScanning();
    expect(noble.startScanningAsync).toHaveBeenCalledTimes(2);
  });
});
```

## Running Tests

### Command Line Options

#### Run All Tests
```bash
npm test
```

#### Run Specific Test File
```bash
npm test tests/ble/bleService.test.js
```

#### Run Tests with Coverage
```bash
npm test -- --coverage
```

#### Run Tests with Verbose Output
```bash
npm test -- --verbose
```

### Test Coverage

#### Coverage Thresholds
```json
{
  "coverageThreshold": {
    "global": {
      "statements": 80,
      "branches": 80,
      "functions": 80,
      "lines": 80
    }
  }
}
```

## Best Practices

### 1. Test Organization
- Group related tests using `describe` blocks
- Use clear, descriptive test names
- Follow the Arrange-Act-Assert pattern

### 2. Mocking
- Mock external dependencies consistently
- Use `jest.fn()` for function mocks
- Reset mocks between tests

### 3. Async Testing
- Use `async/await` for asynchronous tests
- Handle promises properly
- Test both success and failure cases

### 4. Error Cases
- Test all error scenarios
- Verify error messages and types
- Test recovery mechanisms

### 5. Resource Cleanup
- Clean up resources after tests
- Use `afterEach` and `afterAll` hooks
- Verify cleanup in tests

## Common Issues

### 1. Test Timeouts
```javascript
// Increase timeout for specific test
test('long running test', async () => {
  // Test code...
}, 10000); // 10 second timeout
```

### 2. Mock Reset
```javascript
beforeEach(() => {
  jest.clearAllMocks();
});
```

### 3. Async Error Handling
```javascript
test('should handle async errors', async () => {
  await expect(asyncFunction()).rejects.toThrow(Error);
});
```

### 4. Resource Leaks
```javascript
afterEach(() => {
  bleService.cleanup();
  noble.removeAllListeners();
});
```

## Continuous Integration

### GitHub Actions Workflow
```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      - run: npm ci
      - run: npm test
      - run: npm run coverage
```

## Debugging Tests

### 1. Debug Mode
```bash
npm test -- --debug
```

### 2. Test Watch Mode
```bash
npm test -- --watch
```

### 3. Coverage Report
```bash
npm test -- --coverage --coverageReporters="text" --coverageReporters="html"
```

### 4. Test Environment Variables
```bash
DEBUG=ble:* npm test
``` 