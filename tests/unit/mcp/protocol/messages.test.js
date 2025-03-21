const { MessageTypes, ErrorCodes, Validators, MessageBuilder } = require('../../../../src/mcp/protocol/messages');

describe('MCP Protocol Messages', () => {
  describe('MessageTypes', () => {
    it('should define all required message types', () => {
      expect(MessageTypes.CONNECTION_ACK).toBe('connection_ack');
      expect(MessageTypes.START_SCAN).toBe('start_scan');
      expect(MessageTypes.DEVICE_FOUND).toBe('device_found');
      expect(MessageTypes.CONNECT_DEVICE).toBe('connect_device');
      expect(MessageTypes.READ_CHARACTERISTIC).toBe('read_characteristic');
      expect(MessageTypes.ERROR).toBe('error');
    });
  });

  describe('ErrorCodes', () => {
    it('should define all required error codes', () => {
      expect(ErrorCodes.INVALID_MESSAGE).toBe('INVALID_MESSAGE');
      expect(ErrorCodes.BLE_NOT_AVAILABLE).toBe('BLE_NOT_AVAILABLE');
      expect(ErrorCodes.DEVICE_NOT_FOUND).toBe('DEVICE_NOT_FOUND');
      expect(ErrorCodes.CONNECTION_ERROR).toBe('CONNECTION_ERROR');
    });
  });

  describe('Validators', () => {
    describe('validateStartScan', () => {
      it('should validate valid scan parameters', () => {
        const params = {
          duration: 5000,
          filters: [
            { name: 'Test Device' },
            { serviceUuids: ['1234'] }
          ]
        };
        expect(() => Validators.validateStartScan(params)).not.toThrow();
      });

      it('should validate scan parameters without filters', () => {
        const params = { duration: 5000 };
        expect(() => Validators.validateStartScan(params)).not.toThrow();
      });

      it('should throw error for invalid duration', () => {
        const params = { duration: '5000' };
        expect(() => Validators.validateStartScan(params)).toThrow('Duration must be a number');
      });

      it('should throw error for invalid filters', () => {
        const params = { filters: {} };
        expect(() => Validators.validateStartScan(params)).toThrow('Filters must be an array');
      });

      it('should throw error for invalid filter criteria', () => {
        const params = { filters: [{}] };
        expect(() => Validators.validateStartScan(params)).toThrow('Filter must contain at least one of: name, serviceUuids, or manufacturerData');
      });
    });

    describe('validateConnectDevice', () => {
      it('should validate valid device ID', () => {
        const params = { deviceId: 'test_device_1' };
        expect(() => Validators.validateConnectDevice(params)).not.toThrow();
      });

      it('should throw error for missing device ID', () => {
        const params = {};
        expect(() => Validators.validateConnectDevice(params)).toThrow('Device ID is required and must be a string');
      });

      it('should throw error for invalid device ID type', () => {
        const params = { deviceId: 123 };
        expect(() => Validators.validateConnectDevice(params)).toThrow('Device ID is required and must be a string');
      });
    });

    describe('validateCharacteristicOperation', () => {
      it('should validate valid characteristic parameters', () => {
        const params = {
          deviceId: 'test_device_1',
          serviceUuid: 'service_uuid',
          characteristicUuid: 'char_uuid'
        };
        expect(() => Validators.validateCharacteristicOperation(params)).not.toThrow();
      });

      it('should throw error for missing device ID', () => {
        const params = {
          serviceUuid: 'service_uuid',
          characteristicUuid: 'char_uuid'
        };
        expect(() => Validators.validateCharacteristicOperation(params)).toThrow('Device ID is required and must be a string');
      });

      it('should throw error for missing service UUID', () => {
        const params = {
          deviceId: 'test_device_1',
          characteristicUuid: 'char_uuid'
        };
        expect(() => Validators.validateCharacteristicOperation(params)).toThrow('Service UUID is required and must be a string');
      });

      it('should throw error for missing characteristic UUID', () => {
        const params = {
          deviceId: 'test_device_1',
          serviceUuid: 'service_uuid'
        };
        expect(() => Validators.validateCharacteristicOperation(params)).toThrow('Characteristic UUID is required and must be a string');
      });
    });

    describe('validateWriteCharacteristic', () => {
      it('should validate valid write parameters', () => {
        const params = {
          deviceId: 'test_device_1',
          serviceUuid: 'service_uuid',
          characteristicUuid: 'char_uuid',
          value: Buffer.from('test')
        };
        expect(() => Validators.validateWriteCharacteristic(params)).not.toThrow();
      });

      it('should throw error for missing value', () => {
        const params = {
          deviceId: 'test_device_1',
          serviceUuid: 'service_uuid',
          characteristicUuid: 'char_uuid'
        };
        expect(() => Validators.validateWriteCharacteristic(params)).toThrow('Value is required and must be a Buffer');
      });

      it('should throw error for invalid value type', () => {
        const params = {
          deviceId: 'test_device_1',
          serviceUuid: 'service_uuid',
          characteristicUuid: 'char_uuid',
          value: 'test'
        };
        expect(() => Validators.validateWriteCharacteristic(params)).toThrow('Value is required and must be a Buffer');
      });
    });
  });

  describe('MessageBuilder', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockImplementation(() => 1234567890);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('buildConnectionAck', () => {
      it('should build valid connection acknowledgment message', () => {
        const message = MessageBuilder.buildConnectionAck('test_client_1');
        expect(message).toEqual({
          type: MessageTypes.CONNECTION_ACK,
          clientId: 'test_client_1',
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
          rssi: -50,
          manufacturerData: Buffer.from('test'),
          serviceUuids: ['1234', '5678']
        };
        const message = MessageBuilder.buildDeviceFound(device);
        expect(message).toEqual({
          type: MessageTypes.DEVICE_FOUND,
          device: {
            id: 'test_device_1',
            name: 'Test Device',
            address: '00:11:22:33:44:55',
            rssi: -50,
            manufacturerData: Buffer.from('test'),
            serviceUuids: ['1234', '5678']
          },
          timestamp: 1234567890
        });
      });
    });

    describe('buildDeviceConnected', () => {
      it('should build valid device connected message', () => {
        const message = MessageBuilder.buildDeviceConnected('test_device_1');
        expect(message).toEqual({
          type: MessageTypes.DEVICE_CONNECTED,
          deviceId: 'test_device_1',
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
          value: Buffer.from('test')
        };
        const message = MessageBuilder.buildCharacteristicValue(params);
        expect(message).toEqual({
          type: MessageTypes.CHARACTERISTIC_VALUE,
          deviceId: 'test_device_1',
          serviceUuid: 'service_uuid',
          characteristicUuid: 'char_uuid',
          value: Buffer.from('test').toString('base64'),
          timestamp: 1234567890
        });
      });
    });

    describe('buildError', () => {
      it('should build valid error message', () => {
        const message = MessageBuilder.buildError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'Device not found'
        );
        expect(message).toEqual({
          type: MessageTypes.ERROR,
          code: ErrorCodes.DEVICE_NOT_FOUND,
          message: 'Device not found',
          timestamp: 1234567890
        });
      });
    });
  });
}); 