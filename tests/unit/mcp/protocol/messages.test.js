const { 
    MESSAGE_TYPES, 
    ERROR_CODES,
    validateStartScan,
    validateConnectDevice,
    validateCharacteristicOperation,
    validateWriteCharacteristic,
    MessageBuilder
} = require('../../../../src/mcp/protocol/messages');

describe('MCP Protocol Messages', () => {
    describe('Message Types', () => {
        it('should have all required message types', () => {
            expect(MESSAGE_TYPES).toHaveProperty('AUTHENTICATE');
            expect(MESSAGE_TYPES).toHaveProperty('AUTHENTICATED');
            expect(MESSAGE_TYPES).toHaveProperty('SESSION_VALID');
            expect(MESSAGE_TYPES).toHaveProperty('LOGOUT');
            expect(MESSAGE_TYPES).toHaveProperty('LOGGED_OUT');
            expect(MESSAGE_TYPES).toHaveProperty('START_SCAN');
            expect(MESSAGE_TYPES).toHaveProperty('STOP_SCAN');
            expect(MESSAGE_TYPES).toHaveProperty('DEVICE_FOUND');
            expect(MESSAGE_TYPES).toHaveProperty('CONNECT');
            expect(MESSAGE_TYPES).toHaveProperty('DISCONNECT');
            expect(MESSAGE_TYPES).toHaveProperty('CHARACTERISTIC_READ');
            expect(MESSAGE_TYPES).toHaveProperty('CHARACTERISTIC_WRITE');
            expect(MESSAGE_TYPES).toHaveProperty('ERROR');
            expect(MESSAGE_TYPES).toHaveProperty('CONNECTION_ACK');
            expect(MESSAGE_TYPES).toHaveProperty('BATCH');
        });
    });

    describe('Error Codes', () => {
        it('should have all required error codes', () => {
            expect(ERROR_CODES).toHaveProperty('INVALID_API_KEY');
            expect(ERROR_CODES).toHaveProperty('RATE_LIMIT_EXCEEDED');
            expect(ERROR_CODES).toHaveProperty('SESSION_EXPIRED');
            expect(ERROR_CODES).toHaveProperty('INVALID_TOKEN');
            expect(ERROR_CODES).toHaveProperty('NOT_AUTHENTICATED');
            expect(ERROR_CODES).toHaveProperty('AUTH_ERROR');
            expect(ERROR_CODES).toHaveProperty('INVALID_MESSAGE');
            expect(ERROR_CODES).toHaveProperty('INVALID_MESSAGE_TYPE');
            expect(ERROR_CODES).toHaveProperty('MESSAGE_TOO_LARGE');
            expect(ERROR_CODES).toHaveProperty('QUEUE_FULL');
            expect(ERROR_CODES).toHaveProperty('PROCESSING_ERROR');
            expect(ERROR_CODES).toHaveProperty('CONNECTION_LIMIT_REACHED');
            expect(ERROR_CODES).toHaveProperty('CONNECTION_CLOSED');
            expect(ERROR_CODES).toHaveProperty('CONNECTION_ERROR');
            expect(ERROR_CODES).toHaveProperty('SCAN_ALREADY_ACTIVE');
            expect(ERROR_CODES).toHaveProperty('SCAN_NOT_ACTIVE');
            expect(ERROR_CODES).toHaveProperty('DEVICE_NOT_FOUND');
            expect(ERROR_CODES).toHaveProperty('ALREADY_CONNECTED');
            expect(ERROR_CODES).toHaveProperty('NOT_CONNECTED');
            expect(ERROR_CODES).toHaveProperty('INVALID_PARAMS');
            expect(ERROR_CODES).toHaveProperty('OPERATION_FAILED');
            expect(ERROR_CODES).toHaveProperty('BLE_NOT_AVAILABLE');
        });
    });

    describe('Validators', () => {
        describe('validateStartScan', () => {
            it('should validate valid start scan parameters', () => {
                const validParams = {
                    duration: 5000,
                    filters: {
                        name: 'TestDevice',
                        services: ['180D', '180F']
                    }
                };
                expect(() => validateStartScan(validParams)).not.toThrow();
            });

            it('should validate scan parameters without filters', () => {
                const validParams = {
                    duration: 5000
                };
                expect(() => validateStartScan(validParams)).not.toThrow();
            });

            it('should throw error for missing duration', () => {
                const invalidParams = {
                    filters: {
                        name: 'TestDevice'
                    }
                };
                expect(() => validateStartScan(invalidParams)).toThrow('Duration must be a positive number');
            });

            it('should throw error for invalid duration', () => {
                const invalidParams = {
                    duration: -1,
                    filters: {
                        name: 'TestDevice'
                    }
                };
                expect(() => validateStartScan(invalidParams)).toThrow('Duration must be a positive number');
            });

            it('should throw error for invalid filters object', () => {
                const invalidParams = {
                    duration: 5000,
                    filters: 'invalid'
                };
                expect(() => validateStartScan(invalidParams)).toThrow('Filters must be an object');
            });

            it('should throw error for invalid filter criteria', () => {
                const invalidParams = {
                    duration: 5000,
                    filters: {
                        invalid: 'value'
                    }
                };
                expect(() => validateStartScan(invalidParams)).toThrow('Invalid filter criteria');
            });

            it('should throw error for invalid service UUIDs', () => {
                const invalidParams = {
                    duration: 5000,
                    filters: {
                        services: 'invalid'
                    }
                };
                expect(() => validateStartScan(invalidParams)).toThrow('Invalid service UUIDs');
            });
        });

        describe('validateConnectDevice', () => {
            it('should validate valid connect device parameters', () => {
                const validParams = {
                    deviceId: 'test-device-id'
                };
                expect(() => validateConnectDevice(validParams)).not.toThrow();
            });

            it('should throw error for missing device ID', () => {
                const invalidParams = {};
                expect(() => validateConnectDevice(invalidParams)).toThrow('Device ID is required and must be a string');
            });

            it('should throw error for invalid device ID type', () => {
                const invalidParams = {
                    deviceId: 123
                };
                expect(() => validateConnectDevice(invalidParams)).toThrow('Device ID is required and must be a string');
            });
        });

        describe('validateCharacteristicOperation', () => {
            it('should validate valid characteristic operation parameters', () => {
                const validParams = {
                    deviceId: 'test-device-id',
                    serviceUuid: '180D',
                    characteristicUuid: '2A37'
                };
                expect(() => validateCharacteristicOperation(validParams)).not.toThrow();
            });

            it('should throw error for missing device ID', () => {
                const invalidParams = {
                    serviceUuid: '180D',
                    characteristicUuid: '2A37'
                };
                expect(() => validateCharacteristicOperation(invalidParams)).toThrow('Device ID is required and must be a string');
            });

            it('should throw error for missing service UUID', () => {
                const invalidParams = {
                    deviceId: 'test-device-id',
                    characteristicUuid: '2A37'
                };
                expect(() => validateCharacteristicOperation(invalidParams)).toThrow('Service UUID is required and must be a string');
            });

            it('should throw error for missing characteristic UUID', () => {
                const invalidParams = {
                    deviceId: 'test-device-id',
                    serviceUuid: '180D'
                };
                expect(() => validateCharacteristicOperation(invalidParams)).toThrow('Characteristic UUID is required and must be a string');
            });
        });

        describe('validateWriteCharacteristic', () => {
            it('should validate valid write characteristic parameters', () => {
                const validParams = {
                    deviceId: 'test-device-id',
                    serviceUuid: '180D',
                    characteristicUuid: '2A37',
                    value: 'SGVsbG8gV29ybGQ=' // Base64 encoded "Hello World"
                };
                expect(() => validateWriteCharacteristic(validParams)).not.toThrow();
            });

            it('should throw error for missing value', () => {
                const invalidParams = {
                    deviceId: 'test-device-id',
                    serviceUuid: '180D',
                    characteristicUuid: '2A37'
                };
                expect(() => validateWriteCharacteristic(invalidParams)).toThrow('Value is required and must be a base64 encoded string');
            });

            it('should throw error for invalid base64 value', () => {
                const invalidParams = {
                    deviceId: 'test-device-id',
                    serviceUuid: '180D',
                    characteristicUuid: '2A37',
                    value: 'invalid-base64!'
                };
                expect(() => validateWriteCharacteristic(invalidParams)).toThrow('Value is required and must be a base64 encoded string');
            });
        });
    });

    describe('MessageBuilder', () => {
        beforeEach(() => {
            jest.spyOn(Date, 'now').mockReturnValue(1234567890);
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        describe('buildConnectionAck', () => {
            it('should build valid connection acknowledgment message', () => {
                const clientId = 'test-client';
                const message = MessageBuilder.buildConnectionAck(clientId);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CONNECTION_ACK,
                    data: { clientId },
                    timestamp: 1234567890
                });
            });

            it('should handle empty client ID', () => {
                const message = MessageBuilder.buildConnectionAck('');
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CONNECTION_ACK,
                    data: { clientId: '' },
                    timestamp: 1234567890
                });
            });
        });

        describe('buildAuthenticated', () => {
            it('should build valid authenticated message', () => {
                const token = 'test-token';
                const message = MessageBuilder.buildAuthenticated(token);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.AUTHENTICATED,
                    data: { token },
                    timestamp: 1234567890
                });
            });
        });

        describe('buildSessionValidation', () => {
            it('should build valid session validation message', () => {
                const message = MessageBuilder.buildSessionValidation(true);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.SESSION_VALID,
                    data: { valid: true },
                    timestamp: 1234567890
                });
            });
        });

        describe('buildDeviceFound', () => {
            it('should build valid device found message', () => {
                const device = {
                    id: 'test-device',
                    name: 'Test Device',
                    address: '00:11:22:33:44:55',
                    rssi: -60,
                    manufacturerData: Buffer.from('test'),
                    serviceUuids: ['180D', '180F']
                };
                const message = MessageBuilder.buildDeviceFound(device);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.DEVICE_FOUND,
                    device: {
                        id: device.id,
                        name: device.name,
                        address: device.address,
                        rssi: device.rssi,
                        manufacturerData: device.manufacturerData,
                        serviceUuids: device.serviceUuids
                    },
                    timestamp: 1234567890
                });
            });

            it('should handle device with minimal information', () => {
                const device = {
                    id: 'test-device'
                };
                const message = MessageBuilder.buildDeviceFound(device);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.DEVICE_FOUND,
                    device: {
                        id: 'test-device',
                        name: undefined,
                        address: undefined,
                        rssi: undefined,
                        manufacturerData: undefined,
                        serviceUuids: undefined
                    },
                    timestamp: 1234567890
                });
            });
        });

        describe('buildDeviceConnected', () => {
            it('should build valid device connected message', () => {
                const deviceId = 'test-device';
                const message = MessageBuilder.buildDeviceConnected(deviceId);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.DEVICE_CONNECTED,
                    deviceId,
                    timestamp: 1234567890
                });
            });

            it('should handle empty device ID', () => {
                const message = MessageBuilder.buildDeviceConnected('');
                expect(message).toEqual({
                    type: MESSAGE_TYPES.DEVICE_CONNECTED,
                    deviceId: '',
                    timestamp: 1234567890
                });
            });
        });

        describe('buildCharacteristicValue', () => {
            it('should build valid characteristic value message', () => {
                const params = {
                    deviceId: 'test-device',
                    serviceUuid: '180D',
                    characteristicUuid: '2A37',
                    value: 'SGVsbG8gV29ybGQ='
                };
                const message = MessageBuilder.buildCharacteristicValue(params);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CHARACTERISTIC_VALUE,
                    deviceId: params.deviceId,
                    serviceUuid: params.serviceUuid,
                    characteristicUuid: params.characteristicUuid,
                    value: params.value,
                    timestamp: 1234567890
                });
            });

            it('should handle empty value', () => {
                const params = {
                    deviceId: 'test-device',
                    serviceUuid: '180D',
                    characteristicUuid: '2A37',
                    value: ''
                };
                const message = MessageBuilder.buildCharacteristicValue(params);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CHARACTERISTIC_VALUE,
                    deviceId: params.deviceId,
                    serviceUuid: params.serviceUuid,
                    characteristicUuid: params.characteristicUuid,
                    value: '',
                    timestamp: 1234567890
                });
            });
        });

        describe('buildError', () => {
            it('should build valid error message with default empty message', () => {
                const message = MessageBuilder.buildError(ERROR_CODES.INVALID_API_KEY);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.ERROR,
                    code: ERROR_CODES.INVALID_API_KEY,
                    message: '',
                    timestamp: 1234567890
                });
            });

            it('should build valid error message with custom message', () => {
                const customMessage = 'Custom error message';
                const message = MessageBuilder.buildError(ERROR_CODES.INVALID_API_KEY, customMessage);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.ERROR,
                    code: ERROR_CODES.INVALID_API_KEY,
                    message: customMessage,
                    timestamp: 1234567890
                });
            });
        });
    });
}); 