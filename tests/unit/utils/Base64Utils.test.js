const { Readable, Writable } = require('stream');
const { Base64Utils } = require('../../../src/utils/Base64Utils');

// Mock metrics module
jest.mock('../../../src/utils/metrics', () => ({
  metrics: {
    gauge: jest.fn(),
    increment: jest.fn(),
    observe: jest.fn()
  }
}));

// Mock logger module
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Base64Utils', () => {
  let base64Utils;
  let mockLogger;
  let mockMetrics;

  beforeEach(() => {
    mockLogger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    mockMetrics = {
      increment: jest.fn(),
      gauge: jest.fn(),
      histogram: jest.fn()
    };

    base64Utils = new Base64Utils();
    base64Utils.logger = mockLogger;
    base64Utils.metrics = mockMetrics;
  });

  afterEach(() => {
    // Clean up any remaining streams
    jest.clearAllMocks();
  });

  describe('hardware acceleration', () => {
    it('should detect hardware acceleration availability', () => {
      expect(typeof base64Utils.hardwareAccelerationAvailable).toBe('boolean');
    });

    it('should respect hardware acceleration configuration', () => {
      const base64UtilsDisabled = new Base64Utils({ useHardwareAcceleration: false });
      const base64UtilsEnabled = new Base64Utils({ useHardwareAcceleration: true });

      const input = 'Hello World';
      const encodedDisabled = base64UtilsDisabled.encode(input);
      const encodedEnabled = base64UtilsEnabled.encode(input);

      // Both should produce valid base64
      expect(base64UtilsDisabled.isValid(encodedDisabled)).toBe(true);
      expect(base64UtilsEnabled.isValid(encodedEnabled)).toBe(true);
    });

    it('should fallback to standard encoding when hardware acceleration fails', () => {
      const base64Utils = new Base64Utils({ useHardwareAcceleration: true });
      const input = 'Hello World';
            
      // Force hardware acceleration to fail
      base64Utils.hardwareAccelerationAvailable = false;
            
      const encoded = base64Utils.encode(input);
      expect(encoded).toBe('SGVsbG8gV29ybGQ=');
    });

    it('should maintain data integrity with hardware acceleration', () => {
      const base64Utils = new Base64Utils({ useHardwareAcceleration: true });
      const input = 'Hello World';
            
      const encoded = base64Utils.encode(input);
      const decoded = base64Utils.decode(encoded);
            
      expect(decoded.toString()).toBe(input);
    });
  });

  describe('encode', () => {
    it('should encode string to base64', () => {
      const input = 'Hello, World!';
      const expected = 'SGVsbG8sIFdvcmxkIQ==';
      const result = base64Utils.encode(input);
      expect(result).toBe(expected);
    });

    it('should handle empty string', () => {
      const input = '';
      const expected = '';
      const result = base64Utils.encode(input);
      expect(result).toBe(expected);
    });

    it('should handle special characters', () => {
      const input = '!@#$%^&*()';
      const expected = 'IUAjJCVeJiooKQ==';
      const result = base64Utils.encode(input);
      expect(result).toBe(expected);
    });
  });

  describe('decode', () => {
    it('should decode base64 to string', () => {
      const input = 'SGVsbG8sIFdvcmxkIQ==';
      const expected = 'Hello, World!';
      const result = base64Utils.decode(input);
      expect(result.toString()).toBe(expected);
    });

    it('should handle empty string', () => {
      const input = '';
      const result = base64Utils.decode(input);
      expect(result.toString()).toBe('');
    });

    it('should handle special characters', () => {
      const input = 'IUAjJCVeJiooKQ==';
      const expected = '!@#$%^&*()';
      const result = base64Utils.decode(input);
      expect(result.toString()).toBe(expected);
    });

    it('should throw error for invalid base64', () => {
      const input = 'InvalidBase64!';
      expect(() => base64Utils.decode(input)).toThrow('Invalid base64 string');
    });
  });

  describe('isValid', () => {
    it('should return true for valid base64', () => {
      const input = 'SGVsbG8sIFdvcmxkIQ==';
      const result = base64Utils.isValid(input);
      expect(result).toBe(true);
    });

    it('should return false for invalid base64', () => {
      const input = 'InvalidBase64!';
      const result = base64Utils.isValid(input);
      expect(result).toBe(false);
    });

    it('should handle empty string', () => {
      const input = '';
      const result = base64Utils.isValid(input);
      expect(result).toBe(true);
    });
  });

  describe('stream encoding', () => {
    it('should encode stream data', async () => {
      const input = 'Hello World';
      const inputStream = new Readable({
        read() {
          this.push(input);
          this.push(null);
        }
      });

      const chunks = [];
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk);
          callback();
        }
      });

      await base64Utils.streamEncode(inputStream, outputStream);
      expect(Buffer.concat(chunks).toString()).toBe('SGVsbG8gV29ybGQ=');
    });

    it('should handle empty stream', async () => {
      const inputStream = new Readable({
        read() {
          this.push(null);
        }
      });

      const chunks = [];
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk);
          callback();
        }
      });

      await base64Utils.streamEncode(inputStream, outputStream);
      expect(Buffer.concat(chunks).toString()).toBe('');
    });

    it('should handle stream errors', async () => {
      let errorThrown = false;
      const inputStream = new Readable({
        read() {
          if (!errorThrown) {
            errorThrown = true;
            this.emit('error', new Error('Stream error'));
          }
        }
      });

      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        }
      });

      try {
        await base64Utils.streamEncode(inputStream, outputStream);
        expect(false).toBe(true); // This will fail the test if execution reaches here
      } catch (error) {
        expect(error.message).toBe('Stream error');
      }
    });

    it('should handle output stream errors', async () => {
      const inputStream = new Readable({
        read() {
          this.push('test data');
          this.push(null);
        }
      });

      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          callback(new Error('Output stream error'));
        }
      });

      await expect(base64Utils.streamEncode(inputStream, outputStream))
        .rejects
        .toThrow('Output stream error');
    });

    it('should handle input stream errors', async () => {
      let errorThrown = false;
      const inputStream = new Readable({
        read() {
          if (!errorThrown) {
            errorThrown = true;
            this.emit('error', new Error('Input stream error'));
          }
        }
      });

      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        }
      });

      try {
        await base64Utils.streamEncode(inputStream, outputStream);
        expect(false).toBe(true); // This will fail the test if execution reaches here
      } catch (error) {
        expect(error.message).toBe('Input stream error');
      }
    });
  });

  describe('stream decoding', () => {
    it('should decode stream data', async () => {
      const input = 'SGVsbG8gV29ybGQ=';
      const inputStream = new Readable({
        read() {
          this.push(input);
          this.push(null);
        }
      });

      const chunks = [];
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk);
          callback();
        }
      });

      await base64Utils.streamDecode(inputStream, outputStream);
      expect(Buffer.concat(chunks).toString()).toBe('Hello World');
    });

    it('should handle empty stream', async () => {
      const inputStream = new Readable({
        read() {
          this.push(null);
        }
      });

      const chunks = [];
      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk);
          callback();
        }
      });

      await base64Utils.streamDecode(inputStream, outputStream);
      expect(Buffer.concat(chunks).toString()).toBe('');
    });

    it('should handle stream errors', async () => {
      let errorThrown = false;
      const inputStream = new Readable({
        read() {
          if (!errorThrown) {
            errorThrown = true;
            this.emit('error', new Error('Stream error'));
          }
        }
      });

      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        }
      });

      try {
        await base64Utils.streamDecode(inputStream, outputStream);
        expect(false).toBe(true); // This will fail the test if execution reaches here
      } catch (error) {
        expect(error.message).toBe('Stream error');
      }
    });

    it('should handle invalid base64 in stream', async () => {
      const inputStream = new Readable({
        read() {
          this.push('InvalidBase64!@#$');
          this.push(null);
        }
      });

      const outputStream = new Writable({
        write(chunk, encoding, callback) {
          callback();
        }
      });

      try {
        await base64Utils.streamDecode(inputStream, outputStream);
        expect(false).toBe(true); // This will fail the test if execution reaches here
      } catch (error) {
        expect(error.message).toContain('Invalid base64');
      }
    });
  });
}); 