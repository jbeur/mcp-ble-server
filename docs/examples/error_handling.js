const WebSocket = require('ws');

class ResilientClient {
    constructor(serverUrl, apiKey, options = {}) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        this.ws = null;
        this.connected = false;
        this.sessionId = null;
        this.devices = new Map();
        this.retryOptions = {
            maxRetries: options.maxRetries || 3,
            initialDelay: options.initialDelay || 1000,
            maxDelay: options.maxDelay || 30000,
            backoffFactor: options.backoffFactor || 2
        };
        this.retryCount = 0;
        this.currentDelay = this.retryOptions.initialDelay;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = async () => {
                console.log('Connected to MCP server');
                try {
                    await this.authenticate();
                    this.connected = true;
                    this.resetRetryState();
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            this.ws.onmessage = this.handleMessage.bind(this);
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.handleConnectionError(error);
            };
            this.ws.onclose = () => {
                console.log('WebSocket closed');
                this.handleDisconnect();
            };
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

    async connectToDevice(deviceId) {
        return new Promise((resolve, reject) => {
            const message = {
                type: 'CONNECT',
                params: {
                    deviceId
                }
            };

            const handler = (event) => {
                const response = JSON.parse(event.data);
                if (response.type === 'CONNECTED') {
                    this.ws.removeEventListener('message', handler);
                    resolve(response.params);
                } else if (response.type === 'ERROR') {
                    this.ws.removeEventListener('message', handler);
                    reject(new Error(response.message));
                }
            };

            this.ws.addEventListener('message', handler);
            this.ws.send(JSON.stringify(message));
        });
    }

    async readCharacteristic(deviceId, serviceUuid, characteristicUuid) {
        return new Promise((resolve, reject) => {
            const message = {
                type: 'READ_CHARACTERISTIC',
                params: {
                    deviceId,
                    serviceUuid,
                    characteristicUuid
                }
            };

            const handler = (event) => {
                const response = JSON.parse(event.data);
                if (response.type === 'CHARACTERISTIC_READ') {
                    this.ws.removeEventListener('message', handler);
                    resolve(response.params);
                } else if (response.type === 'ERROR') {
                    this.ws.removeEventListener('message', handler);
                    reject(new Error(response.message));
                }
            };

            this.ws.addEventListener('message', handler);
            this.ws.send(JSON.stringify(message));
        });
    }

    handleMessage(event) {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);

        switch (message.type) {
            case 'ERROR':
                this.handleError(message);
                break;
        }
    }

    handleError(error) {
        console.error('Error:', error);
        // Handle specific error types
        switch (error.code) {
            case 'RATE_LIMIT_EXCEEDED':
                this.handleRateLimitError(error);
                break;
            case 'SESSION_EXPIRED':
                this.handleSessionExpired();
                break;
            case 'CONNECTION_ERROR':
                this.handleConnectionError(error);
                break;
            default:
                console.error('Unhandled error:', error);
        }
    }

    handleRateLimitError(error) {
        const resetTime = new Date(error.details.reset);
        const delay = resetTime.getTime() - Date.now();
        console.log(`Rate limit exceeded. Waiting ${delay}ms before retrying...`);
        setTimeout(() => {
            this.retryOperation();
        }, delay);
    }

    handleSessionExpired() {
        console.log('Session expired, reconnecting...');
        this.disconnect();
        this.connect();
    }

    handleConnectionError(error) {
        if (this.retryCount < this.retryOptions.maxRetries) {
            console.log(`Connection error, retrying in ${this.currentDelay}ms...`);
            setTimeout(() => {
                this.retryCount++;
                this.currentDelay = Math.min(
                    this.currentDelay * this.retryOptions.backoffFactor,
                    this.retryOptions.maxDelay
                );
                this.connect();
            }, this.currentDelay);
        } else {
            console.error('Max retries reached, giving up');
            this.disconnect();
        }
    }

    resetRetryState() {
        this.retryCount = 0;
        this.currentDelay = this.retryOptions.initialDelay;
    }

    handleDisconnect() {
        console.log('Disconnected from MCP server');
        this.connected = false;
        this.sessionId = null;
        this.devices.clear();
        this.handleConnectionError(new Error('Connection closed'));
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Example usage
async function main() {
    const client = new ResilientClient('ws://localhost:8080/mcp', 'your-api-key', {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2
    });

    try {
        await client.connect();
        console.log('Connected and authenticated');

        // Example device and characteristic UUIDs
        const deviceId = 'device-id';
        const serviceUuid = 'service-uuid';
        const characteristicUuid = 'characteristic-uuid';

        // Connect to device with retry logic
        await client.connectToDevice(deviceId);
        console.log('Connected to device');

        // Read characteristic with error handling
        try {
            const result = await client.readCharacteristic(
                deviceId,
                serviceUuid,
                characteristicUuid
            );
            const value = Buffer.from(result.value, 'base64');
            console.log('Characteristic value:', value);
        } catch (error) {
            console.error('Failed to read characteristic:', error);
            // Handle specific error cases
            if (error.message.includes('timeout')) {
                console.log('Operation timed out, retrying...');
                // Implement retry logic for specific operations
            }
        }

        // Clean up
        client.disconnect();
    } catch (error) {
        console.error('Fatal error:', error);
        client.disconnect();
    }
}

main(); 