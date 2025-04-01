# MCP Client Examples

This directory contains example implementations demonstrating how to use the MCP BLE Server client library.

## Examples

### 1. Basic Client (`basic_client.js`)
A basic implementation showing core functionality:
- WebSocket connection establishment
- Authentication
- Device discovery
- Device connection/disconnection
- Characteristic read/write operations

### 2. Notification Handling (`notifications.js`)
Demonstrates how to handle BLE notifications:
- Subscribing to characteristic notifications
- Processing notification events
- Unsubscribing from notifications
- Example with temperature sensor data

### 3. Error Handling (`error_handling.js`)
Shows robust error handling and retry logic:
- Connection error handling
- Rate limit handling
- Session expiration handling
- Exponential backoff retry logic
- Configurable retry options

## Usage

1. Install dependencies:
```bash
npm install ws
```

2. Update the server URL and API key in each example:
```javascript
const client = new Client('ws://your-server:port/mcp', 'your-api-key');
```

3. Run an example:
```bash
node basic_client.js
```

## Best Practices

1. **Connection Management**
   - Always clean up resources by calling `disconnect()`
   - Handle connection errors appropriately
   - Implement reconnection logic for production use

2. **Error Handling**
   - Catch and handle all potential errors
   - Implement appropriate retry logic
   - Log errors for debugging

3. **Resource Cleanup**
   - Unsubscribe from notifications when done
   - Disconnect from devices when not in use
   - Clean up event listeners

4. **Security**
   - Never hardcode API keys
   - Use environment variables for sensitive data
   - Implement proper session management

## Contributing

Feel free to submit additional examples or improvements to existing ones. Please follow these guidelines:

1. Include clear comments explaining the code
2. Add error handling for all operations
3. Implement proper resource cleanup
4. Follow the project's coding style
5. Add a description of what the example demonstrates

## License

These examples are part of the MCP BLE Server project and follow the same license terms. 