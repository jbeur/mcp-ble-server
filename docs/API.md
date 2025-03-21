# API Documentation

## Overview
This document provides detailed information about the MCP BLE Server API, including authentication, message types, and usage examples.

## Authentication

### Authentication Flow
1. Connect to the WebSocket server
2. Authenticate using an API key
3. Receive a JWT token
4. Use the token for subsequent requests
5. Validate session when needed
6. Logout when done

### Authentication Messages

#### Authenticate
Authenticate with the server using an API key.

```javascript
// Request
{
    "type": "AUTHENTICATE",
    "params": {
        "apiKey": "your-api-key"
    }
}

// Response
{
    "type": "AUTHENTICATED",
    "params": {
        "token": "jwt-token",
        "expiresIn": "24h"
    }
}
```

#### Validate Session
Validate the current session token.

```javascript
// Request
{
    "type": "SESSION_VALID",
    "params": {
        "token": "your-jwt-token"
    }
}

// Response
{
    "type": "SESSION_VALID",
    "params": {
        "valid": true|false
    }
}
```

#### Logout
End the current session.

```javascript
// Request
{
    "type": "LOGOUT"
}

// Response
{
    "type": "LOGGED_OUT"
}
```

### Error Responses
```javascript
{
    "type": "ERROR",
    "code": "ERROR_CODE",
    "message": "Error description"
}
```

Common error codes:
- `INVALID_API_KEY`: The provided API key is invalid
- `RATE_LIMIT_EXCEEDED`: Too many requests in the current time window
- `SESSION_EXPIRED`: The session token has expired
- `INVALID_TOKEN`: The provided token is invalid
- `INVALID_PARAMS`: Missing or invalid parameters in the request

## BLE Operations

### Device Discovery
Start scanning for BLE devices.

```javascript
// Request
{
    "type": "SCAN_START",
    "params": {
        "duration": 5,  // Optional: scan duration in seconds
        "filters": {    // Optional: device filters
            "name": "MyDevice",
            "services": ["service-uuid"]
        }
    }
}

// Response
{
    "type": "SCAN_STARTED"
}

// Device Discovery Event
{
    "type": "DEVICE_DISCOVERED",
    "params": {
        "id": "device-id",
        "name": "device-name",
        "address": "device-address",
        "rssi": -65,
        "manufacturerData": {}
    }
}
```

Stop scanning for devices.

```javascript
// Request
{
    "type": "SCAN_STOP"
}

// Response
{
    "type": "SCAN_STOPPED"
}
```

### Device Connection
Connect to a BLE device.

```javascript
// Request
{
    "type": "CONNECT",
    "params": {
        "deviceId": "device-id"
    }
}

// Response
{
    "type": "CONNECTED",
    "params": {
        "deviceId": "device-id",
        "name": "device-name",
        "address": "device-address"
    }
}
```

Disconnect from a device.

```javascript
// Request
{
    "type": "DISCONNECT",
    "params": {
        "deviceId": "device-id"
    }
}

// Response
{
    "type": "DISCONNECTED",
    "params": {
        "deviceId": "device-id"
    }
}
```

### Characteristic Operations
Read a characteristic value.

```javascript
// Request
{
    "type": "READ_CHARACTERISTIC",
    "params": {
        "deviceId": "device-id",
        "serviceUuid": "service-uuid",
        "characteristicUuid": "characteristic-uuid"
    }
}

// Response
{
    "type": "CHARACTERISTIC_READ",
    "params": {
        "deviceId": "device-id",
        "serviceUuid": "service-uuid",
        "characteristicUuid": "characteristic-uuid",
        "value": "base64-encoded-value"
    }
}
```

Write a characteristic value.

```javascript
// Request
{
    "type": "WRITE_CHARACTERISTIC",
    "params": {
        "deviceId": "device-id",
        "serviceUuid": "service-uuid",
        "characteristicUuid": "characteristic-uuid",
        "value": "base64-encoded-value"
    }
}

// Response
{
    "type": "CHARACTERISTIC_WRITTEN",
    "params": {
        "deviceId": "device-id",
        "serviceUuid": "service-uuid",
        "characteristicUuid": "characteristic-uuid"
    }
}
```

## Rate Limiting
The server implements rate limiting to prevent abuse:
- Rate limit window: 1 minute
- Maximum requests per window: 100
- Rate limit is applied per client ID

## Session Management
- Sessions expire after 24 hours of inactivity
- Sessions are automatically cleaned up every 5 minutes
- Each client can have one active session at a time

## Error Handling
All errors are returned in a consistent format:
```javascript
{
    "type": "ERROR",
    "code": "ERROR_CODE",
    "message": "Human-readable error description"
}
```

Common error scenarios:
1. Authentication failures
2. Rate limit exceeded
3. Invalid parameters
4. Device not found
5. Connection failures
6. Operation timeouts

## Best Practices
1. Always authenticate before performing BLE operations
2. Validate session before critical operations
3. Handle rate limiting gracefully
4. Implement proper error handling
5. Clean up resources by logging out when done
6. Use appropriate timeouts for operations
7. Monitor connection state
8. Implement retry logic for transient failures

## Example Usage

```javascript
const WebSocket = require('ws');

async function connectAndAuthenticate() {
    const ws = new WebSocket('ws://localhost:8080');
    
    return new Promise((resolve, reject) => {
        ws.on('open', async () => {
            try {
                // Authenticate
                ws.send(JSON.stringify({
                    type: 'AUTHENTICATE',
                    params: {
                        apiKey: 'your-api-key'
                    }
                }));

                // Handle authentication response
                ws.on('message', (data) => {
                    const response = JSON.parse(data);
                    if (response.type === 'AUTHENTICATED') {
                        resolve({
                            ws,
                            token: response.params.token
                        });
                    } else if (response.type === 'ERROR') {
                        reject(new Error(response.message));
                    }
                });
            } catch (error) {
                reject(error);
            }
        });

        ws.on('error', reject);
    });
}

async function scanForDevices(ws) {
    return new Promise((resolve, reject) => {
        const devices = [];

        // Start scanning
        ws.send(JSON.stringify({
            type: 'SCAN_START',
            params: {
                duration: 5
            }
        }));

        // Handle device discovery
        ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.type === 'DEVICE_DISCOVERED') {
                devices.push(message.params);
            } else if (message.type === 'SCAN_STOPPED') {
                resolve(devices);
            } else if (message.type === 'ERROR') {
                reject(new Error(message.message));
            }
        });
    });
}

// Usage example
async function main() {
    try {
        // Connect and authenticate
        const { ws, token } = await connectAndAuthenticate();
        
        // Scan for devices
        const devices = await scanForDevices(ws);
        console.log('Discovered devices:', devices);
        
        // Clean up
        ws.send(JSON.stringify({ type: 'LOGOUT' }));
        ws.close();
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
``` 