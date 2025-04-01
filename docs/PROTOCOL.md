# MCP Protocol Specification

## Overview
The MCP (Model Context Protocol) is a WebSocket-based protocol designed to enable AI assistants to interact with BLE devices through a standardized interface. This document specifies the protocol format, message types, and communication patterns.

## Connection Establishment

### WebSocket Connection
```javascript
// Connect to the MCP server
const ws = new WebSocket('ws://your-server:port/mcp');

// Connection event handlers
ws.onopen = () => {
    console.log('Connected to MCP server');
};

ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};

ws.onclose = () => {
    console.log('Disconnected from MCP server');
};
```

### Authentication
After establishing the WebSocket connection, clients must authenticate using an API key:

```javascript
// Authentication message
{
    "type": "auth",
    "payload": {
        "apiKey": "your-api-key"
    }
}

// Successful authentication response
{
    "type": "auth_response",
    "status": "success",
    "sessionId": "unique-session-id"
}

// Failed authentication response
{
    "type": "auth_response",
    "status": "error",
    "error": "Invalid API key"
}
```

## Message Format

All messages follow this basic structure:
```javascript
{
    "type": "message_type",
    "payload": {
        // Message-specific data
    },
    "timestamp": "ISO-8601 timestamp",
    "messageId": "unique-message-id"
}
```

## Available Commands

### 1. Device Discovery
```javascript
// Start device scanning
{
    "type": "scan_start",
    "payload": {
        "filters": {
            "services": ["service-uuid-1", "service-uuid-2"],
            "name": "device-name",
            "rssi": -80
        }
    }
}

// Stop device scanning
{
    "type": "scan_stop"
}

// Device discovered event
{
    "type": "device_discovered",
    "payload": {
        "deviceId": "unique-device-id",
        "name": "device-name",
        "rssi": -75,
        "services": ["service-uuid-1"],
        "manufacturerData": "base64-encoded-data"
    }
}
```

### 2. Device Connection
```javascript
// Connect to device
{
    "type": "connect",
    "payload": {
        "deviceId": "unique-device-id",
        "timeout": 5000
    }
}

// Disconnect from device
{
    "type": "disconnect",
    "payload": {
        "deviceId": "unique-device-id"
    }
}

// Connection status event
{
    "type": "connection_status",
    "payload": {
        "deviceId": "unique-device-id",
        "status": "connected|disconnected|error",
        "error": "error-message-if-any"
    }
}
```

### 3. Characteristic Operations
```javascript
// Read characteristic
{
    "type": "read_characteristic",
    "payload": {
        "deviceId": "unique-device-id",
        "serviceId": "service-uuid",
        "characteristicId": "characteristic-uuid"
    }
}

// Write characteristic
{
    "type": "write_characteristic",
    "payload": {
        "deviceId": "unique-device-id",
        "serviceId": "service-uuid",
        "characteristicId": "characteristic-uuid",
        "value": "base64-encoded-value"
    }
}

// Characteristic notification subscription
{
    "type": "subscribe_characteristic",
    "payload": {
        "deviceId": "unique-device-id",
        "serviceId": "service-uuid",
        "characteristicId": "characteristic-uuid"
    }
}

// Characteristic value event
{
    "type": "characteristic_value",
    "payload": {
        "deviceId": "unique-device-id",
        "serviceId": "service-uuid",
        "characteristicId": "characteristic-uuid",
        "value": "base64-encoded-value"
    }
}
```

## Error Handling

All error responses follow this format:
```javascript
{
    "type": "error",
    "payload": {
        "code": "ERROR_CODE",
        "message": "Human-readable error message",
        "details": {
            // Additional error details
        }
    }
}
```

Common error codes:
- `AUTH_ERROR`: Authentication failed
- `DEVICE_NOT_FOUND`: Requested device not found
- `CONNECTION_ERROR`: Failed to connect to device
- `OPERATION_TIMEOUT`: Operation timed out
- `INVALID_MESSAGE`: Invalid message format
- `PERMISSION_DENIED`: Insufficient permissions

## Rate Limiting

The server implements rate limiting to prevent abuse:
- Maximum 100 connections per IP
- Maximum 1000 messages per minute per connection
- Maximum 100 device connections per session

Rate limit exceeded responses:
```javascript
{
    "type": "error",
    "payload": {
        "code": "RATE_LIMIT_EXCEEDED",
        "message": "Rate limit exceeded",
        "details": {
            "limit": 1000,
            "reset": "timestamp"
        }
    }
}
```

## Best Practices

1. **Connection Management**
   - Implement reconnection logic with exponential backoff
   - Handle connection errors gracefully
   - Clean up resources on disconnection

2. **Message Handling**
   - Validate message format before sending
   - Include messageId for tracking
   - Handle all possible response types

3. **Error Handling**
   - Implement proper error recovery
   - Log errors for debugging
   - Show user-friendly error messages

4. **Resource Management**
   - Disconnect from devices when not in use
   - Unsubscribe from notifications when done
   - Clean up event listeners

## Example Implementation

```javascript
class MCPClient {
    constructor(serverUrl, apiKey) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        this.ws = null;
        this.connected = false;
        this.sessionId = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = async () => {
                await this.authenticate();
                this.connected = true;
                resolve();
            };

            this.ws.onmessage = this.handleMessage.bind(this);
            this.ws.onerror = reject;
            this.ws.onclose = this.handleDisconnect.bind(this);
        });
    }

    async authenticate() {
        return new Promise((resolve, reject) => {
            const message = {
                type: 'auth',
                payload: { apiKey: this.apiKey }
            };

            this.ws.send(JSON.stringify(message));

            const handler = (event) => {
                const response = JSON.parse(event.data);
                if (response.type === 'auth_response') {
                    if (response.status === 'success') {
                        this.sessionId = response.sessionId;
                        this.ws.removeEventListener('message', handler);
                        resolve();
                    } else {
                        this.ws.removeEventListener('message', handler);
                        reject(new Error(response.error));
                    }
                }
            };

            this.ws.addEventListener('message', handler);
        });
    }

    handleMessage(event) {
        const message = JSON.parse(event.data);
        // Handle different message types
        switch (message.type) {
            case 'device_discovered':
                this.handleDeviceDiscovered(message.payload);
                break;
            case 'connection_status':
                this.handleConnectionStatus(message.payload);
                break;
            case 'characteristic_value':
                this.handleCharacteristicValue(message.payload);
                break;
            case 'error':
                this.handleError(message.payload);
                break;
        }
    }

    handleDisconnect() {
        this.connected = false;
        this.sessionId = null;
        // Implement reconnection logic
    }

    // Implement other methods for device operations
}
``` 