const WebSocket = require('ws');

class MCPClient {
    constructor(serverUrl, apiKey) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        this.ws = null;
        this.connected = false;
        this.sessionId = null;
        this.devices = new Map();
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

    startScanning(filters = {}) {
        const message = {
            type: 'SCAN_START',
            params: {
                duration: 5,
                filters
            }
        };
        this.ws.send(JSON.stringify(message));
    }

    stopScanning() {
        const message = {
            type: 'SCAN_STOP'
        };
        this.ws.send(JSON.stringify(message));
    }

    connectToDevice(deviceId) {
        const message = {
            type: 'CONNECT',
            params: {
                deviceId
            }
        };
        this.ws.send(JSON.stringify(message));
    }

    disconnectFromDevice(deviceId) {
        const message = {
            type: 'DISCONNECT',
            params: {
                deviceId
            }
        };
        this.ws.send(JSON.stringify(message));
    }

    readCharacteristic(deviceId, serviceUuid, characteristicUuid) {
        const message = {
            type: 'READ_CHARACTERISTIC',
            params: {
                deviceId,
                serviceUuid,
                characteristicUuid
            }
        };
        this.ws.send(JSON.stringify(message));
    }

    writeCharacteristic(deviceId, serviceUuid, characteristicUuid, value) {
        const message = {
            type: 'WRITE_CHARACTERISTIC',
            params: {
                deviceId,
                serviceUuid,
                characteristicUuid,
                value
            }
        };
        this.ws.send(JSON.stringify(message));
    }

    handleMessage(event) {
        const message = JSON.parse(event.data);
        console.log('Received message:', message);

        switch (message.type) {
            case 'DEVICE_DISCOVERED':
                this.handleDeviceDiscovered(message.params);
                break;
            case 'CONNECTED':
                this.handleDeviceConnected(message.params);
                break;
            case 'DISCONNECTED':
                this.handleDeviceDisconnected(message.params);
                break;
            case 'CHARACTERISTIC_READ':
                this.handleCharacteristicRead(message.params);
                break;
            case 'CHARACTERISTIC_WRITTEN':
                this.handleCharacteristicWritten(message.params);
                break;
            case 'ERROR':
                this.handleError(message);
                break;
        }
    }

    handleDeviceDiscovered(device) {
        console.log('Device discovered:', device);
        this.devices.set(device.id, device);
    }

    handleDeviceConnected(device) {
        console.log('Device connected:', device);
        this.devices.set(device.id, {
            ...this.devices.get(device.id),
            connected: true
        });
    }

    handleDeviceDisconnected(device) {
        console.log('Device disconnected:', device);
        this.devices.set(device.id, {
            ...this.devices.get(device.id),
            connected: false
        });
    }

    handleCharacteristicRead(params) {
        console.log('Characteristic read:', params);
        // Handle the characteristic value
        const value = Buffer.from(params.value, 'base64');
        console.log('Value:', value);
    }

    handleCharacteristicWritten(params) {
        console.log('Characteristic written:', params);
    }

    handleError(error) {
        console.error('Error:', error);
    }

    handleDisconnect() {
        console.log('Disconnected from MCP server');
        this.connected = false;
        this.sessionId = null;
        this.devices.clear();
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Example usage
async function main() {
    const client = new MCPClient('ws://localhost:8080/mcp', 'your-api-key');

    try {
        await client.connect();
        console.log('Connected and authenticated');

        // Start scanning for devices
        client.startScanning({
            name: 'MyDevice',
            services: ['service-uuid']
        });

        // Wait for devices to be discovered
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Stop scanning
        client.stopScanning();

        // Connect to the first discovered device
        const devices = Array.from(client.devices.values());
        if (devices.length > 0) {
            const device = devices[0];
            client.connectToDevice(device.id);

            // Wait for connection
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Read a characteristic
            client.readCharacteristic(
                device.id,
                'service-uuid',
                'characteristic-uuid'
            );

            // Write a characteristic
            const value = Buffer.from('Hello, BLE!').toString('base64');
            client.writeCharacteristic(
                device.id,
                'service-uuid',
                'characteristic-uuid',
                value
            );

            // Disconnect from device
            client.disconnectFromDevice(device.id);
        }

        // Clean up
        client.disconnect();
    } catch (error) {
        console.error('Error:', error);
        client.disconnect();
    }
}

main();