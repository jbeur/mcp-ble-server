# API Documentation

## Overview
This document provides detailed information about the MCP BLE Server API, including classes, methods, events, and usage examples.

## BLEService Class

### Constructor

```javascript
const bleService = new BLEService(config);
```

**Parameters:**
- `config` (Object, optional): Configuration object with the following properties:
  ```javascript
  {
    device_filters: [],           // Array of device filters
    scan_duration: 10,            // Scan duration in seconds
    connection_timeout: 5,        // Connection timeout in seconds
    auto_reconnect: true,         // Enable automatic reconnection
    reconnection_attempts: 3      // Maximum reconnection attempts
  }
  ```

### Methods

#### startScanning()
Start scanning for BLE devices.

```javascript
await bleService.startScanning();
```

**Returns:** Promise<void>

**Throws:**
- `BLEScanError`: If scanning fails to start
- `BLEError`: For other BLE-related errors

#### stopScanning()
Stop scanning for BLE devices.

```javascript
await bleService.stopScanning();
```

**Returns:** Promise<void>

**Throws:**
- `BLEScanError`: If scanning fails to stop
- `BLEError`: For other BLE-related errors

#### connectToDevice(device)
Connect to a specific BLE device.

```javascript
const device = await bleService.connectToDevice({
  name: 'MyDevice',
  alias: 'my-device'
});
```

**Parameters:**
- `device` (Object): Device object with the following properties:
  ```javascript
  {
    name: string,           // Device name
    address: string,        // Device MAC address
    services: string[],     // Array of service UUIDs
    alias: string          // Custom alias for the device
  }
  ```

**Returns:** Promise<BLEDevice>

**Throws:**
- `BLEDeviceError`: If device is not found
- `BLEConnectionError`: If connection fails
- `BLEError`: For other BLE-related errors

#### disconnectFromDevice(deviceId)
Disconnect from a specific device.

```javascript
await bleService.disconnectFromDevice('device-1');
```

**Parameters:**
- `deviceId` (string): ID or alias of the device to disconnect

**Returns:** Promise<void>

**Throws:**
- `BLEDeviceError`: If device is not found
- `BLEConnectionError`: If disconnection fails
- `BLEError`: For other BLE-related errors

#### getConnectedDevices()
Get a list of currently connected devices.

```javascript
const devices = bleService.getConnectedDevices();
```

**Returns:** Map<string, BLEDevice>

#### cleanup()
Clean up resources and remove event listeners.

```javascript
bleService.cleanup();
```

**Returns:** void

### Events

#### deviceDiscovered
Emitted when a new device is discovered during scanning.

```javascript
bleService.on('deviceDiscovered', (device) => {
  console.log('Discovered device:', device);
});
```

**Event Data:**
```javascript
{
  id: string,              // Unique device ID
  name: string,            // Device name
  address: string,         // Device MAC address
  rssi: number,           // Signal strength
  advertisementData: Buffer // Raw advertisement data
}
```

#### deviceConnected
Emitted when a device is successfully connected.

```javascript
bleService.on('deviceConnected', (device) => {
  console.log('Connected to device:', device);
});
```

**Event Data:** BLEDevice object

#### deviceDisconnected
Emitted when a device is disconnected.

```javascript
bleService.on('deviceDisconnected', (deviceId) => {
  console.log('Device disconnected:', deviceId);
});
```

**Event Data:** string (device ID)

#### error
Emitted when an error occurs.

```javascript
bleService.on('error', (error) => {
  console.error('BLE error:', error);
});
```

**Event Data:** BLEError object

## BLEDevice Class

### Methods

#### readCharacteristic(serviceUuid, characteristicUuid)
Read data from a characteristic.

```javascript
const data = await device.readCharacteristic(
  '180f',
  '2a19'
);
```

**Parameters:**
- `serviceUuid` (string): UUID of the service
- `characteristicUuid` (string): UUID of the characteristic

**Returns:** Promise<Buffer>

**Throws:**
- `BLEDeviceError`: If characteristic is not found
- `BLEError`: For other BLE-related errors

#### writeCharacteristic(serviceUuid, characteristicUuid, data)
Write data to a characteristic.

```javascript
await device.writeCharacteristic(
  '180f',
  '2a19',
  Buffer.from([0x01])
);
```

**Parameters:**
- `serviceUuid` (string): UUID of the service
- `characteristicUuid` (string): UUID of the characteristic
- `data` (Buffer): Data to write

**Returns:** Promise<void>

**Throws:**
- `BLEDeviceError`: If characteristic is not found
- `BLEError`: For other BLE-related errors

#### subscribeToCharacteristic(serviceUuid, characteristicUuid)
Subscribe to characteristic notifications.

```javascript
await device.subscribeToCharacteristic(
  '180f',
  '2a19'
);
```

**Parameters:**
- `serviceUuid` (string): UUID of the service
- `characteristicUuid` (string): UUID of the characteristic

**Returns:** Promise<void>

**Throws:**
- `BLEDeviceError`: If characteristic is not found
- `BLEError`: For other BLE-related errors

#### unsubscribeFromCharacteristic(serviceUuid, characteristicUuid)
Unsubscribe from characteristic notifications.

```javascript
await device.unsubscribeFromCharacteristic(
  '180f',
  '2a19'
);
```

**Parameters:**
- `serviceUuid` (string): UUID of the service
- `characteristicUuid` (string): UUID of the characteristic

**Returns:** Promise<void>

**Throws:**
- `BLEDeviceError`: If characteristic is not found
- `BLEError`: For other BLE-related errors

### Events

#### characteristicValueChanged
Emitted when a characteristic value changes.

```javascript
device.on('characteristicValueChanged', (serviceUuid, characteristicUuid, data) => {
  console.log('Characteristic value changed:', {
    service: serviceUuid,
    characteristic: characteristicUuid,
    data: data
  });
});
```

**Event Data:**
- `serviceUuid` (string): UUID of the service
- `characteristicUuid` (string): UUID of the characteristic
- `data` (Buffer): New characteristic value

#### disconnected
Emitted when the device is disconnected.

```javascript
device.on('disconnected', () => {
  console.log('Device disconnected');
});
```

## Error Types

### BLEError
Base error class for all BLE-related errors.

```javascript
class BLEError extends Error {
  constructor(message, code = 'BLE_ERROR');
}
```

### BLEDeviceError
Error class for device-related errors.

```javascript
class BLEDeviceError extends BLEError {
  constructor(message, deviceId);
}
```

### BLEScanError
Error class for scanning-related errors.

```javascript
class BLEScanError extends BLEError {
  constructor(message);
}
```

### BLEConnectionError
Error class for connection-related errors.

```javascript
class BLEConnectionError extends BLEError {
  constructor(message, deviceId);
}
```

## Usage Examples

### Basic Device Discovery and Connection

```javascript
const { BLEService } = require('./src/ble/bleService');

async function main() {
  const bleService = new BLEService();

  try {
    // Start scanning
    await bleService.startScanning();

    // Handle discovered devices
    bleService.on('deviceDiscovered', (device) => {
      console.log('Discovered:', device.name);
    });

    // Connect to a specific device
    const device = await bleService.connectToDevice({
      name: 'MyDevice',
      alias: 'my-device'
    });

    // Handle device events
    device.on('characteristicValueChanged', (serviceUuid, characteristicUuid, data) => {
      console.log('Value changed:', data);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    bleService.cleanup();
  }
}

main();
```

### Reading and Writing Characteristics

```javascript
async function handleDevice(device) {
  try {
    // Read battery level
    const batteryData = await device.readCharacteristic(
      '180f',
      '2a19'
    );
    console.log('Battery level:', batteryData[0]);

    // Write to a characteristic
    await device.writeCharacteristic(
      '180f',
      '2a19',
      Buffer.from([0x01])
    );

    // Subscribe to notifications
    await device.subscribeToCharacteristic(
      '180f',
      '2a19'
    );

  } catch (error) {
    console.error('Device error:', error);
  }
}
```

### Error Handling

```javascript
const { BLEError, BLEDeviceError, BLEScanError, BLEConnectionError } = require('./src/utils/bleErrors');

async function handleBLE() {
  try {
    await bleService.startScanning();
  } catch (error) {
    if (error instanceof BLEScanError) {
      console.error('Scanning failed:', error.message);
    } else if (error instanceof BLEConnectionError) {
      console.error('Connection failed:', error.message);
    } else if (error instanceof BLEDeviceError) {
      console.error('Device error:', error.message);
    } else {
      console.error('Unexpected error:', error.message);
    }
  }
}
``` 