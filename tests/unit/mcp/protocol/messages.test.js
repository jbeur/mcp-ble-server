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
    describe('MessageTypes', () => {
        it('should define all required message types', () => {
            expect(MESSAGE_TYPES).toBeDefined();
            expect(MESSAGE_TYPES.AUTHENTICATE).toBe('AUTHENTICATE');
            expect(MESSAGE_TYPES.AUTHENTICATED).toBe('AUTHENTICATED');
            expect(MESSAGE_TYPES.SESSION_VALID).toBe('SESSION_VALID');
            expect(MESSAGE_TYPES.LOGOUT).toBe('LOGOUT');
            expect(MESSAGE_TYPES.LOGGED_OUT).toBe('LOGGED_OUT');
            expect(MESSAGE_TYPES.START_SCAN).toBe('START_SCAN');
            expect(MESSAGE_TYPES.STOP_SCAN).toBe('STOP_SCAN');
            expect(MESSAGE_TYPES.DEVICE_FOUND).toBe('DEVICE_FOUND');
            expect(MESSAGE_TYPES.CONNECT).toBe('CONNECT');
            expect(MESSAGE_TYPES.DISCONNECT).toBe('DISCONNECT');
            expect(MESSAGE_TYPES.CHARACTERISTIC_READ).toBe('CHARACTERISTIC_READ');
            expect(MESSAGE_TYPES.CHARACTERISTIC_WRITE).toBe('CHARACTERISTIC_WRITE');
            expect(MESSAGE_TYPES.ERROR).toBe('ERROR');
            expect(MESSAGE_TYPES.CONNECTION_ACK).toBe('CONNECTION_ACK');
        });
    });

    describe('ErrorCodes', () => {
        it('should define all required error codes', () => {
            expect(ERROR_CODES).toBeDefined();
            expect(ERROR_CODES.INVALID_API_KEY).toBe('INVALID_API_KEY');
            expect(ERROR_CODES.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
            expect(ERROR_CODES.SESSION_EXPIRED).toBe('SESSION_EXPIRED');
            expect(ERROR_CODES.INVALID_TOKEN).toBe('INVALID_TOKEN');
            expect(ERROR_CODES.SCAN_ALREADY_ACTIVE).toBe('SCAN_ALREADY_ACTIVE');
            expect(ERROR_CODES.SCAN_NOT_ACTIVE).toBe('SCAN_NOT_ACTIVE');
            expect(ERROR_CODES.DEVICE_NOT_FOUND).toBe('DEVICE_NOT_FOUND');
            expect(ERROR_CODES.ALREADY_CONNECTED).toBe('ALREADY_CONNECTED');
            expect(ERROR_CODES.NOT_CONNECTED).toBe('NOT_CONNECTED');
            expect(ERROR_CODES.INVALID_PARAMS).toBe('INVALID_PARAMS');
            expect(ERROR_CODES.OPERATION_FAILED).toBe('OPERATION_FAILED');
            expect(ERROR_CODES.INVALID_MESSAGE).toBe('INVALID_MESSAGE');
            expect(ERROR_CODES.BLE_NOT_AVAILABLE).toBe('BLE_NOT_AVAILABLE');
            expect(ERROR_CODES.CONNECTION_ERROR).toBe('CONNECTION_ERROR');
        });
    });

    describe('Validators', () => {
        describe('validateStartScan', () => {
            it('should validate valid scan parameters', () => {
                const params = {
                    duration: 5,
                    filters: {
                        services: ['180d'],
                        name: 'Test Device'
                    }
                };
                expect(() => validateStartScan(params)).not.toThrow();
            });

            it('should validate scan parameters without filters', () => {
                const params = {
                    duration: 5
                };
                expect(() => validateStartScan(params)).not.toThrow();
            });

            it('should throw error for invalid duration', () => {
                const params = {
                    duration: -1
                };
                expect(() => validateStartScan(params)).toThrow('Duration must be a positive number');
            });

            it('should throw error for missing duration', () => {
                const params = {};
                expect(() => validateStartScan(params)).toThrow('Duration must be a positive number');
            });

            it('should throw error for invalid filters', () => {
                const params = {
                    duration: 5,
                    filters: 'invalid'
                };
                expect(() => validateStartScan(params)).toThrow('Filters must be an object');
            });

            it('should throw error for invalid filter criteria', () => {
                const params = {
                    duration: 5,
                    filters: {
                        invalid: 'value'
                    }
                };
                expect(() => validateStartScan(params)).toThrow('Invalid filter criteria');
            });

            it('should throw error for invalid service UUIDs', () => {
                const params = {
                    duration: 5,
                    filters: {
                        services: 'invalid'
                    }
                };
                expect(() => validateStartScan(params)).toThrow('Invalid service UUIDs');
            });
        });

        describe('validateConnectDevice', () => {
            it('should validate valid device ID', () => {
                const params = {
                    deviceId: 'test-device-1'
                };
                expect(() => validateConnectDevice(params)).not.toThrow();
            });

            it('should throw error for missing device ID', () => {
                const params = {};
                expect(() => validateConnectDevice(params)).toThrow('Device ID is required and must be a string');
            });

            it('should throw error for invalid device ID type', () => {
                const params = {
                    deviceId: 123
                };
                expect(() => validateConnectDevice(params)).toThrow('Device ID is required and must be a string');
            });
        });

        describe('validateCharacteristicOperation', () => {
            it('should validate valid characteristic parameters', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: '180f',
                    characteristicUuid: '2a19'
                };
                expect(() => validateCharacteristicOperation(params)).not.toThrow();
            });

            it('should throw error for missing device ID', () => {
                const params = {
                    serviceUuid: '180f',
                    characteristicUuid: '2a19'
                };
                expect(() => validateCharacteristicOperation(params)).toThrow('Device ID is required and must be a string');
            });

            it('should throw error for missing service UUID', () => {
                const params = {
                    deviceId: 'test-device-1',
                    characteristicUuid: '2a19'
                };
                expect(() => validateCharacteristicOperation(params)).toThrow('Service UUID is required and must be a string');
            });

            it('should throw error for missing characteristic UUID', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: '180f'
                };
                expect(() => validateCharacteristicOperation(params)).toThrow('Characteristic UUID is required and must be a string');
            });

            it('should throw error for invalid service UUID type', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: 123,
                    characteristicUuid: '2a19'
                };
                expect(() => validateCharacteristicOperation(params)).toThrow('Service UUID is required and must be a string');
            });

            it('should throw error for invalid characteristic UUID type', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: '180f',
                    characteristicUuid: 123
                };
                expect(() => validateCharacteristicOperation(params)).toThrow('Characteristic UUID is required and must be a string');
            });
        });

        describe('validateWriteCharacteristic', () => {
            it('should validate valid write parameters', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: '180f',
                    characteristicUuid: '2a19',
                    value: Buffer.from([0x01]).toString('base64')
                };
                expect(() => validateWriteCharacteristic(params)).not.toThrow();
            });

            it('should throw error for missing value', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: '180f',
                    characteristicUuid: '2a19'
                };
                expect(() => validateWriteCharacteristic(params)).toThrow('Value is required and must be a base64 encoded string');
            });

            it('should throw error for invalid value type', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: '180f',
                    characteristicUuid: '2a19',
                    value: 123
                };
                expect(() => validateWriteCharacteristic(params)).toThrow('Value is required and must be a base64 encoded string');
            });

            it('should throw error for invalid base64 value', () => {
                const params = {
                    deviceId: 'test-device-1',
                    serviceUuid: '180f',
                    characteristicUuid: '2a19',
                    value: 'invalid-base64!'
                };
                expect(() => validateWriteCharacteristic(params)).toThrow('Value is required and must be a base64 encoded string');
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
                const message = MessageBuilder.buildConnectionAck('test-device-1');
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CONNECTION_ACK,
                    clientId: 'test-device-1',
                    timestamp: 1234567890
                });
            });

            it('should handle empty client ID', () => {
                const message = MessageBuilder.buildConnectionAck('');
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CONNECTION_ACK,
                    clientId: '',
                    timestamp: 1234567890
                });
            });
        });

        describe('buildDeviceFound', () => {
            it('should build valid device found message', () => {
                const device = {
                    id: 'test_device_1',
                    name: 'Test Device',
                    address: '00:11:22:33:44:55',
                    rssi: -65,
                    manufacturerData: Buffer.from([0x01, 0x02]).toString('base64'),
                    serviceUuids: ['180f', '180d']
                };
                const message = MessageBuilder.buildDeviceFound(device);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.DEVICE_FOUND,
                    device: {
                        id: 'test_device_1',
                        name: 'Test Device',
                        address: '00:11:22:33:44:55',
                        rssi: -65,
                        manufacturerData: 'AQI=',
                        serviceUuids: ['180f', '180d']
                    },
                    timestamp: 1234567890
                });
            });

            it('should handle device with minimal information', () => {
                const device = {
                    id: 'test_device_1'
                };
                const message = MessageBuilder.buildDeviceFound(device);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.DEVICE_FOUND,
                    device: {
                        id: 'test_device_1',
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
                const message = MessageBuilder.buildDeviceConnected('test-device-1');
                expect(message).toEqual({
                    type: MESSAGE_TYPES.DEVICE_CONNECTED,
                    deviceId: 'test-device-1',
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
                    deviceId: 'test_device_1',
                    serviceUuid: 'service_uuid',
                    characteristicUuid: 'char_uuid',
                    value: Buffer.from([0x01]).toString('base64')
                };
                const message = MessageBuilder.buildCharacteristicValue(params);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CHARACTERISTIC_VALUE,
                    deviceId: 'test_device_1',
                    serviceUuid: 'service_uuid',
                    characteristicUuid: 'char_uuid',
                    value: 'AQ==',
                    timestamp: 1234567890
                });
            });

            it('should handle empty value', () => {
                const params = {
                    deviceId: 'test_device_1',
                    serviceUuid: 'service_uuid',
                    characteristicUuid: 'char_uuid',
                    value: ''
                };
                const message = MessageBuilder.buildCharacteristicValue(params);
                expect(message).toEqual({
                    type: MESSAGE_TYPES.CHARACTERISTIC_VALUE,
                    deviceId: 'test_device_1',
                    serviceUuid: 'service_uuid',
                    characteristicUuid: 'char_uuid',
                    value: '',
                    timestamp: 1234567890
                });
            });
        });

        describe('buildError', () => {
            it('should build valid error message', () => {
                const message = MessageBuilder.buildError(
                    ERROR_CODES.DEVICE_NOT_FOUND,
                    'Device not found'
                );
                expect(message).toEqual({
                    type: MESSAGE_TYPES.ERROR,
                    code: ERROR_CODES.DEVICE_NOT_FOUND,
                    message: 'Device not found',
                    timestamp: 1234567890
                });
            });

            it('should handle empty error message', () => {
                const message = MessageBuilder.buildError(
                    ERROR_CODES.DEVICE_NOT_FOUND,
                    ''
                );
                expect(message).toEqual({
                    type: MESSAGE_TYPES.ERROR,
                    code: ERROR_CODES.DEVICE_NOT_FOUND,
                    message: '',
                    timestamp: 1234567890
                });
            });
        });
    });
}); 