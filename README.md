# MCP BLE Server

A robust and reliable Bluetooth Low Energy (BLE) server implementation for Node.js, designed to handle device discovery, connection management, and data communication with BLE devices.

## Features

- **Device Discovery**: Scan and discover BLE devices with configurable filters
- **Connection Management**: Handle device connections with automatic reconnection support
- **Error Handling**: Comprehensive error handling with custom error types
- **Resource Management**: Proper cleanup of resources and event listeners
- **Configuration**: YAML-based configuration system for easy customization
- **Testing**: Comprehensive test suite with unit and integration tests

## Prerequisites

- Node.js >= 14.x
- npm >= 6.x
- Bluetooth adapter with BLE support
- Linux/macOS (Windows support coming soon)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/mcp-ble-server.git
cd mcp-ble-server
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

Create a `config/default.yaml` file with your BLE settings:

```yaml
ble:
  device_filters: []           # Array of device filters
  scan_duration: 10            # Scan duration in seconds
  connection_timeout: 5        # Connection timeout in seconds
  auto_reconnect: true         # Enable automatic reconnection
  reconnection_attempts: 3     # Maximum reconnection attempts
```

See [Configuration Guide](docs/CONFIGURATION.md) for detailed configuration options.

## Usage

### Basic Usage

```javascript
const { BLEService } = require('./src/ble/bleService');

async function main() {
  const bleService = new BLEService();

  try {
    // Start scanning for devices
    await bleService.startScanning();

    // Handle discovered devices
    bleService.on('deviceDiscovered', (device) => {
      console.log('Discovered device:', device);
    });

    // Connect to a device
    const device = await bleService.connectToDevice({
      name: 'MyDevice',
      alias: 'my-device'
    });

    // Handle device events
    device.on('data', (data) => {
      console.log('Received data:', data);
    });

  } catch (error) {
    console.error('BLE error:', error);
  } finally {
    // Clean up resources
    bleService.cleanup();
  }
}

main();
```

### Error Handling

```javascript
const { BLEError, BLEDeviceError, BLEScanError, BLEConnectionError } = require('./src/utils/bleErrors');

try {
  await bleService.startScanning();
} catch (error) {
  if (error instanceof BLEScanError) {
    console.error('Scanning failed:', error.message);
  } else if (error instanceof BLEConnectionError) {
    console.error('Connection failed:', error.message);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## API Documentation

See [API Documentation](docs/API.md) for detailed information about the available methods and events.

## Testing

Run the test suite:

```bash
npm test
```

Run tests with coverage:

```bash
npm test -- --coverage
```

See [Testing Guide](docs/TESTING.md) for detailed information about testing.

## Error Handling

The library provides custom error types for different BLE-related errors:

- `BLEError`: Base error class for all BLE-related errors
- `BLEDeviceError`: Errors related to device operations
- `BLEScanError`: Errors during device scanning
- `BLEConnectionError`: Errors during device connection

See [Error Handling Guide](docs/ERROR_HANDLING.md) for detailed information about error handling.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [@abandonware/noble](https://github.com/abandonware/noble) - BLE library for Node.js
- [winston](https://github.com/winstonjs/winston) - Logging library
- [jest](https://github.com/facebook/jest) - Testing framework

## Support

For support, please open an issue in the GitHub repository or contact the maintainers. 