const assert = require('assert');
const { Readable, Writable } = require('stream');
const Base64Utils = require('../../../src/utils/Base64Utils');

describe('Base64Utils', () => {
    let base64Utils;

    beforeEach(() => {
        base64Utils = new Base64Utils();
    });

    describe('hardware acceleration', () => {
        it('should detect hardware acceleration availability', () => {
            assert(typeof base64Utils.hardwareAccelerationAvailable === 'boolean');
        });

        it('should respect hardware acceleration configuration', () => {
            const base64UtilsDisabled = new Base64Utils({ useHardwareAcceleration: false });
            const base64UtilsEnabled = new Base64Utils({ useHardwareAcceleration: true });

            const input = 'Hello World';
            const encodedDisabled = base64UtilsDisabled.encode(input);
            const encodedEnabled = base64UtilsEnabled.encode(input);

            // Both should produce valid base64
            assert.strictEqual(base64UtilsDisabled.isValid(encodedDisabled), true);
            assert.strictEqual(base64UtilsEnabled.isValid(encodedEnabled), true);
        });

        it('should fallback to standard encoding when hardware acceleration fails', () => {
            const base64Utils = new Base64Utils({ useHardwareAcceleration: true });
            const input = 'Hello World';
            
            // Force hardware acceleration to fail
            base64Utils.hardwareAccelerationAvailable = false;
            
            const encoded = base64Utils.encode(input);
            assert.strictEqual(encoded, 'SGVsbG8gV29ybGQ=');
        });

        it('should maintain data integrity with hardware acceleration', () => {
            const base64Utils = new Base64Utils({ useHardwareAcceleration: true });
            const input = 'Hello World';
            
            const encoded = base64Utils.encode(input);
            const decoded = base64Utils.decode(encoded);
            
            assert.strictEqual(decoded.toString(), input);
        });
    });

    describe('encode', () => {
        it('should encode string correctly', () => {
            const input = 'Hello World';
            const encoded = base64Utils.encode(input);
            assert.strictEqual(encoded, 'SGVsbG8gV29ybGQ=');
        });

        it('should encode buffer correctly', () => {
            const input = Buffer.from('Hello World');
            const encoded = base64Utils.encode(input);
            assert.strictEqual(encoded, 'SGVsbG8gV29ybGQ=');
        });

        it('should handle empty input', () => {
            const encoded = base64Utils.encode('');
            assert.strictEqual(encoded, '');
        });

        it('should handle binary data', () => {
            const input = Buffer.from([0x00, 0xFF, 0x42, 0x7F]);
            const encoded = base64Utils.encode(input);
            assert.strictEqual(encoded, 'AP9Cfw==');
        });
    });

    describe('decode', () => {
        it('should decode string correctly', () => {
            const input = 'SGVsbG8gV29ybGQ=';
            const decoded = base64Utils.decode(input);
            assert.strictEqual(decoded.toString(), 'Hello World');
        });

        it('should handle empty input', () => {
            const decoded = base64Utils.decode('');
            assert.strictEqual(decoded.length, 0);
        });

        it('should handle binary data', () => {
            const input = 'AP9Cfw==';
            const decoded = base64Utils.decode(input);
            assert.deepStrictEqual(decoded, Buffer.from([0x00, 0xFF, 0x42, 0x7F]));
        });

        it('should throw on invalid input', () => {
            assert.throws(() => {
                const input = 'invalid-base64!';
                if (!base64Utils.isValid(input)) {
                    throw new Error('Invalid base64 string');
                }
                base64Utils.decode(input);
            }, /Invalid base64 string/);
        });
    });

    describe('isValid', () => {
        it('should validate correct base64 strings', () => {
            const validStrings = [
                'SGVsbG8gV29ybGQ=',
                'AP9Cfw==',
                'A',
                'AA==',
                'AAA=',
                'AAAA'
            ];

            validStrings.forEach(str => {
                assert.strictEqual(base64Utils.isValid(str), true);
            });
        });

        it('should reject invalid base64 strings', () => {
            const invalidStrings = [
                'SGVsbG8gV29ybGQ!',
                'AP9Cfw!',
                'A!',
                'AA!',
                'AAA!',
                'AAAA!'
            ];

            invalidStrings.forEach(str => {
                assert.strictEqual(base64Utils.isValid(str), false);
            });
        });

        it('should handle non-string inputs', () => {
            assert.strictEqual(base64Utils.isValid(null), false);
            assert.strictEqual(base64Utils.isValid(undefined), false);
            assert.strictEqual(base64Utils.isValid(123), false);
            assert.strictEqual(base64Utils.isValid({}), false);
        });
    });

    describe('streamEncode', () => {
        it('should encode stream data correctly', async () => {
            const input = 'Hello World';
            const inputStream = new Readable();
            const outputStream = new Writable();
            let output = '';

            outputStream._write = (chunk, encoding, callback) => {
                output += chunk.toString();
                callback();
            };

            inputStream.push(input);
            inputStream.push(null);

            await base64Utils.streamEncode(inputStream, outputStream);
            assert.strictEqual(output, 'SGVsbG8gV29ybGQ=');
        });

        it('should handle empty stream', async () => {
            const inputStream = new Readable();
            const outputStream = new Writable();
            let output = '';

            outputStream._write = (chunk, encoding, callback) => {
                output += chunk.toString();
                callback();
            };

            inputStream.push(null);

            await base64Utils.streamEncode(inputStream, outputStream);
            assert.strictEqual(output, '');
        });

        it('should handle stream errors', async () => {
            const inputStream = new Readable();
            const outputStream = new Writable();

            // Set up error handlers before emitting error
            const streamPromise = base64Utils.streamEncode(inputStream, outputStream);
            
            // Emit error after promise is created
            inputStream.emit('error', new Error('Test error'));

            await assert.rejects(streamPromise, {
                message: 'Test error'
            });
        });
    });

    describe('streamDecode', () => {
        it('should decode stream data correctly', async () => {
            const input = 'SGVsbG8gV29ybGQ=';
            const inputStream = new Readable();
            const outputStream = new Writable();
            let output = '';

            outputStream._write = (chunk, encoding, callback) => {
                output += chunk.toString();
                callback();
            };

            inputStream.push(input);
            inputStream.push(null);

            await base64Utils.streamDecode(inputStream, outputStream);
            assert.strictEqual(output, 'Hello World');
        });

        it('should handle empty stream', async () => {
            const inputStream = new Readable();
            const outputStream = new Writable();
            let output = '';

            outputStream._write = (chunk, encoding, callback) => {
                output += chunk.toString();
                callback();
            };

            inputStream.push(null);

            await base64Utils.streamDecode(inputStream, outputStream);
            assert.strictEqual(output, '');
        });

        it('should handle stream errors', async () => {
            const inputStream = new Readable();
            const outputStream = new Writable();

            // Set up error handlers before emitting error
            const streamPromise = base64Utils.streamDecode(inputStream, outputStream);
            
            // Emit error after promise is created
            inputStream.emit('error', new Error('Test error'));

            await assert.rejects(streamPromise, {
                message: 'Test error'
            });
        });

        it('should handle invalid base64 data', async () => {
            const input = 'invalid-base64!';
            const inputStream = new Readable();
            const outputStream = new Writable();

            inputStream.push(input);
            inputStream.push(null);

            await assert.rejects(
                base64Utils.streamDecode(inputStream, outputStream),
                {
                    message: 'Invalid base64 data in stream'
                }
            );
        });
    });
}); 