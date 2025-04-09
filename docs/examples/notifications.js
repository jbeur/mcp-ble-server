const WebSocket = require('ws');

class NotificationClient {
  constructor(serverUrl, apiKey) {
    this.serverUrl = serverUrl;
    this.apiKey = apiKey;
    this.ws = null;
    this.connected = false;
    this.sessionId = null;
    this.devices = new Map();
    this.notificationHandlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = async () => {
        console.log('Connected to MCP server');
        await this.authenticate();
        this.connected = true;
        resolve();
      };

      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
      this.ws.onclose = this.handleDisconnect.bind(this);
    });
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      const message = {
        type: 'AUTHENTICATE',
        params: {
          apiKey: this.apiKey
        }
      };

      this.ws.send(JSON.stringify(message));

      const handler = (event) => {
        const response = JSON.parse(event.data);
        if (response.type === 'AUTHENTICATED') {
          this.sessionId = response.params.token;
          this.ws.removeEventListener('message', handler);
          resolve();
        } else if (response.type === 'ERROR') {
          this.ws.removeEventListener('message', handler);
          reject(new Error(response.message));
        }
      };

      this.ws.addEventListener('message', handler);
    });
  }

  subscribeToNotifications(deviceId, serviceUuid, characteristicUuid, handler) {
    const key = `${deviceId}:${serviceUuid}:${characteristicUuid}`;
    this.notificationHandlers.set(key, handler);

    const message = {
      type: 'SUBSCRIBE_CHARACTERISTIC',
      params: {
        deviceId,
        serviceUuid,
        characteristicUuid
      }
    };
    this.ws.send(JSON.stringify(message));
  }

  unsubscribeFromNotifications(deviceId, serviceUuid, characteristicUuid) {
    const key = `${deviceId}:${serviceUuid}:${characteristicUuid}`;
    this.notificationHandlers.delete(key);

    const message = {
      type: 'UNSUBSCRIBE_CHARACTERISTIC',
      params: {
        deviceId,
        serviceUuid,
        characteristicUuid
      }
    };
    this.ws.send(JSON.stringify(message));
  }

  handleMessage(event) {
    const message = JSON.parse(event.data);
    console.log('Received message:', message);

    switch (message.type) {
    case 'CHARACTERISTIC_NOTIFICATION':
      this.handleNotification(message.params);
      break;
    case 'ERROR':
      this.handleError(message);
      break;
    }
  }

  handleNotification(params) {
    const { deviceId, serviceUuid, characteristicUuid, value } = params;
    const key = `${deviceId}:${serviceUuid}:${characteristicUuid}`;
    const handler = this.notificationHandlers.get(key);

    if (handler) {
      const decodedValue = Buffer.from(value, 'base64');
      handler(decodedValue);
    }
  }

  handleError(error) {
    console.error('Error:', error);
  }

  handleDisconnect() {
    console.log('Disconnected from MCP server');
    this.connected = false;
    this.sessionId = null;
    this.devices.clear();
    this.notificationHandlers.clear();
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Example usage
async function main() {
  const client = new NotificationClient('ws://localhost:8080/mcp', 'your-api-key');

  try {
    await client.connect();
    console.log('Connected and authenticated');

    // Example device and characteristic UUIDs
    const deviceId = 'device-id';
    const serviceUuid = 'service-uuid';
    const characteristicUuid = 'characteristic-uuid';

    // Subscribe to notifications
    client.subscribeToNotifications(
      deviceId,
      serviceUuid,
      characteristicUuid,
      (value) => {
        console.log('Received notification:', value);
        // Process the notification value
        // For example, if it's temperature data:
        const temperature = value.readFloatLE(0);
        console.log(`Temperature: ${temperature}°C`);
      }
    );

    // Keep the connection alive to receive notifications
    await new Promise(resolve => setTimeout(resolve, 60000));

    // Unsubscribe from notifications
    client.unsubscribeFromNotifications(deviceId, serviceUuid, characteristicUuid);

    // Clean up
    client.disconnect();
  } catch (error) {
    console.error('Error:', error);
    client.disconnect();
  }
}

main(); 