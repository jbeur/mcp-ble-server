# Error Handling Guide

## Overview
This guide provides comprehensive information about error handling in the MCP BLE Server, including error types, recovery strategies, and best practices.

## Error Types

### BLEError
Base error class for all BLE-related errors.

```javascript
class BLEError extends Error {
  constructor(message, code = 'BLE_ERROR') {
    super(message);
    this.name = 'BLEError';
    this.code = code;
  }
}
```

### BLEDeviceError
Error class for device-related errors.

```javascript
class BLEDeviceError extends BLEError {
  constructor(message, deviceId) {
    super(message, 'DEVICE_ERROR');
    this.name = 'BLEDeviceError';
    this.deviceId = deviceId;
  }
}
```

### BLEScanError
Error class for scanning-related errors.

```javascript
class BLEScanError extends BLEError {
  constructor(message) {
    super(message, 'SCAN_ERROR');
    this.name = 'BLEScanError';
  }
}
```

### BLEConnectionError
Error class for connection-related errors.

```javascript
class BLEConnectionError extends BLEError {
  constructor(message, deviceId) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'BLEConnectionError';
    this.deviceId = deviceId;
  }
}
```

## Error Recovery Strategies

### 1. Retry Mechanism

The BLE service implements a retry mechanism for recoverable errors:

```javascript
async function withRetry(operation, maxAttempts = 3, delay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (!isRecoverableError(error)) {
        throw error;
      }
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
        continue;
      }
    }
  }
  
  throw lastError;
}
```

### 2. Error Classification

Errors are classified as either recoverable or non-recoverable:

#### Recoverable Errors
- Scanning failures
- Connection timeouts
- Temporary device unavailability
- Interference issues

#### Non-Recoverable Errors
- Invalid device configuration
- Unsupported BLE features
- Hardware failures
- Permission issues

### 3. Recovery Actions

#### Scanning Errors
```javascript
try {
  await bleService.startScanning();
} catch (error) {
  if (error instanceof BLEScanError) {
    // Stop scanning if active
    await bleService.stopScanning();
    
    // Wait for BLE stack to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Retry scanning
    await bleService.startScanning();
  } else {
    throw error;
  }
}
```

#### Connection Errors
```javascript
try {
  await bleService.connectToDevice(device);
} catch (error) {
  if (error instanceof BLEConnectionError) {
    // Disconnect if partially connected
    await bleService.disconnectFromDevice(device.id);
    
    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Retry connection
    await bleService.connectToDevice(device);
  } else {
    throw error;
  }
}
```

## Common Error Scenarios

### 1. Device Not Found

```javascript
try {
  const device = await bleService.connectToDevice({
    name: 'NonExistentDevice'
  });
} catch (error) {
  if (error instanceof BLEDeviceError) {
    console.error('Device not found:', error.deviceId);
    // Handle device not found
  } else {
    throw error;
  }
}
```

### 2. Connection Timeout

```javascript
try {
  await bleService.connectToDevice(device);
} catch (error) {
  if (error instanceof BLEConnectionError) {
    console.error('Connection timeout:', error.deviceId);
    // Handle connection timeout
  } else {
    throw error;
  }
}
```

### 3. Scanning Failure

```javascript
try {
  await bleService.startScanning();
} catch (error) {
  if (error instanceof BLEScanError) {
    console.error('Scanning failed:', error.message);
    // Handle scanning failure
  } else {
    throw error;
  }
}
```

## Error Handling Best Practices

### 1. Use Try-Catch Blocks

Always wrap BLE operations in try-catch blocks:

```javascript
async function handleBLEOperation() {
  try {
    await bleService.startScanning();
    // Handle success
  } catch (error) {
    // Handle error
    console.error('Operation failed:', error);
  }
}
```

### 2. Implement Error Recovery

Implement recovery mechanisms for recoverable errors:

```javascript
async function withRecovery(operation) {
  try {
    return await operation();
  } catch (error) {
    if (isRecoverableError(error)) {
      return await recoverFromError(error);
    }
    throw error;
  }
}
```

### 3. Log Errors Appropriately

Use appropriate log levels for different error types:

```javascript
function logError(error) {
  if (error instanceof BLEError) {
    logger.error('BLE error:', {
      type: error.name,
      code: error.code,
      message: error.message
    });
  } else {
    logger.error('Unexpected error:', error);
  }
}
```

### 4. Clean Up Resources

Always clean up resources in error cases:

```javascript
async function handleDeviceOperation(device) {
  try {
    await device.connect();
    // Perform operations
  } catch (error) {
    // Handle error
    console.error('Operation failed:', error);
  } finally {
    // Clean up
    await device.disconnect();
  }
}
```

## Troubleshooting Guide

### Common Issues

#### 1. Device Discovery Issues

**Symptoms:**
- No devices found during scanning
- Intermittent device discovery
- Duplicate device entries

**Solutions:**
1. Check BLE adapter status
2. Verify device is in range
3. Ensure device is advertising
4. Check for interference
5. Adjust scan duration

#### 2. Connection Problems

**Symptoms:**
- Connection timeouts
- Failed connections
- Intermittent disconnections

**Solutions:**
1. Verify device is discoverable
2. Check signal strength
3. Reduce interference
4. Adjust connection timeout
5. Enable auto-reconnection

#### 3. Data Transfer Issues

**Symptoms:**
- Failed reads/writes
- Corrupted data
- Slow transfer rates

**Solutions:**
1. Check MTU size
2. Verify characteristic properties
3. Monitor signal strength
4. Implement retry logic
5. Use appropriate transfer modes

### Debugging Tips

#### 1. Enable Debug Logging

```javascript
const logger = require('winston');

logger.level = 'debug';
```

#### 2. Monitor Signal Strength

```javascript
bleService.on('deviceDiscovered', (device) => {
  console.log('Device RSSI:', device.rssi);
});
```

#### 3. Check Device State

```javascript
const device = bleService.getConnectedDevices().get(deviceId);
if (device && device.isConnected) {
  // Device is connected
}
```

#### 4. Verify Permissions

```javascript
try {
  await bleService.startScanning();
} catch (error) {
  if (error.code === 'PERMISSION_DENIED') {
    // Handle permission issues
  }
}
```

## Error Prevention

### 1. Input Validation

Validate device parameters before operations:

```javascript
function validateDevice(device) {
  if (!device.name && !device.address && !device.services) {
    throw new BLEDeviceError('Invalid device parameters');
  }
}
```

### 2. State Management

Check service state before operations:

```javascript
function checkServiceState() {
  if (!bleService.isInitialized) {
    throw new BLEError('Service not initialized');
  }
}
```

### 3. Resource Management

Implement proper resource cleanup:

```javascript
class BLEService {
  constructor() {
    this.resources = new Set();
  }

  cleanup() {
    for (const resource of this.resources) {
      resource.dispose();
    }
    this.resources.clear();
  }
}
```

### 4. Error Monitoring

Implement error monitoring and reporting:

```javascript
class ErrorMonitor {
  constructor() {
    this.errors = new Map();
  }

  recordError(error) {
    const count = this.errors.get(error.code) || 0;
    this.errors.set(error.code, count + 1);
  }

  getErrorStats() {
    return Object.fromEntries(this.errors);
  }
}
``` 