# Configuration Guide

## Overview
The MCP BLE Server uses a YAML-based configuration system for managing BLE settings, device filters, and other operational parameters. This guide explains the configuration structure and options.

## Configuration File Structure

### Default Configuration
```yaml
# config/default.yaml
ble:
  device_filters: []           # Array of device filters
  scan_duration: 10            # Scan duration in seconds
  connection_timeout: 5        # Connection timeout in seconds
  auto_reconnect: true         # Enable automatic reconnection
  reconnection_attempts: 3     # Maximum reconnection attempts
```

### Custom Configuration
```yaml
# config/custom.yaml
ble:
  device_filters:
    - name: "MyDevice"         # Device name to filter
      alias: "my-device"       # Custom alias for the device
    - address: "00:11:22:33:44:55"  # Device address to filter
      alias: "device-1"
    - services: ["180f"]       # Service UUIDs to filter
      alias: "battery-service"
  scan_duration: 15            # Custom scan duration
  connection_timeout: 10       # Custom connection timeout
  auto_reconnect: true         # Enable auto-reconnection
  reconnection_attempts: 5     # Custom reconnection attempts
```

## Configuration Options

### BLE Settings

#### device_filters
Array of device filters for identifying specific BLE devices.

```yaml
device_filters:
  - name: "DeviceName"         # Filter by device name
    alias: "custom-alias"      # Optional custom alias
  - address: "00:11:22:33:44:55"  # Filter by MAC address
    alias: "device-1"
  - services: ["180f", "180a"] # Filter by service UUIDs
    alias: "service-device"
```

**Properties:**
- `name` (string): Device name to match
- `address` (string): Device MAC address to match
- `services` (string[]): Array of service UUIDs to match
- `alias` (string): Custom alias for the device

#### scan_duration
Duration of BLE scanning in seconds.

```yaml
scan_duration: 10  # Scan for 10 seconds
```

**Default:** 10 seconds
**Range:** 1-60 seconds

#### connection_timeout
Timeout for device connections in seconds.

```yaml
connection_timeout: 5  # 5 second timeout
```

**Default:** 5 seconds
**Range:** 1-30 seconds

#### auto_reconnect
Enable automatic reconnection to devices.

```yaml
auto_reconnect: true  # Enable auto-reconnection
```

**Default:** true
**Type:** boolean

#### reconnection_attempts
Maximum number of reconnection attempts.

```yaml
reconnection_attempts: 3  # Try to reconnect 3 times
```

**Default:** 3
**Range:** 1-10

## Configuration Validation

### Required Fields
- `ble` section must be present
- `device_filters` must be an array
- `scan_duration` must be a positive number
- `connection_timeout` must be a positive number
- `auto_reconnect` must be a boolean
- `reconnection_attempts` must be a positive number

### Validation Rules
1. Scan duration must be between 1 and 60 seconds
2. Connection timeout must be between 1 and 30 seconds
3. Reconnection attempts must be between 1 and 10
4. Device filters must have at least one matching criterion
5. Service UUIDs must be valid UUID format

## Configuration Loading

### Default Configuration
```javascript
const config = require('./config/default.yaml');
```

### Custom Configuration
```javascript
const config = require('./config/custom.yaml');
```

### Configuration Override
```javascript
const config = {
  ...require('./config/default.yaml'),
  ...require('./config/custom.yaml')
};
```

## Example Configurations

### Basic Configuration
```yaml
ble:
  device_filters: []
  scan_duration: 10
  connection_timeout: 5
  auto_reconnect: true
  reconnection_attempts: 3
```

### Advanced Configuration
```yaml
ble:
  device_filters:
    - name: "HeartRateMonitor"
      alias: "hr-monitor"
    - services: ["180d", "180f"]
      alias: "health-device"
  scan_duration: 15
  connection_timeout: 8
  auto_reconnect: true
  reconnection_attempts: 5
```

### Production Configuration
```yaml
ble:
  device_filters:
    - address: "00:11:22:33:44:55"
      alias: "primary-device"
    - name: "BackupDevice"
      alias: "backup"
  scan_duration: 20
  connection_timeout: 10
  auto_reconnect: true
  reconnection_attempts: 3
```

## Best Practices

### 1. Use Aliases
Always provide meaningful aliases for devices:
```yaml
device_filters:
  - name: "DeviceName"
    alias: "meaningful-alias"  # Use descriptive aliases
```

### 2. Set Appropriate Timeouts
Adjust timeouts based on your use case:
```yaml
scan_duration: 15        # Longer scan for better discovery
connection_timeout: 8    # Longer timeout for slow connections
```

### 3. Enable Auto-Reconnection
Enable auto-reconnection for reliability:
```yaml
auto_reconnect: true
reconnection_attempts: 3
```

### 4. Use Multiple Filter Criteria
Combine different filter criteria for better device identification:
```yaml
device_filters:
  - name: "DeviceName"
    services: ["180f"]
    alias: "specific-device"
```

### 5. Validate Configuration
Always validate your configuration:
```javascript
const { validateConfig } = require('./config/configLoader');
validateConfig(config);
```

## Troubleshooting

### Common Issues

1. **Configuration Not Loading**
   - Check file path
   - Verify YAML syntax
   - Check file permissions

2. **Invalid Device Filters**
   - Verify device names
   - Check MAC address format
   - Validate service UUIDs

3. **Timeout Issues**
   - Adjust scan duration
   - Modify connection timeout
   - Check device responsiveness

4. **Reconnection Problems**
   - Verify auto_reconnect setting
   - Check reconnection_attempts
   - Monitor device availability 