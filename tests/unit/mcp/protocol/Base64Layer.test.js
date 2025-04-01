const { Readable } = require('stream');
const Base64Layer = require('../../../../src/mcp/protocol/Base64Layer');
const { metrics } = require('../../../../src/utils/metrics');

// Mock metrics
jest.mock('../../../../src/utils/metrics', () => ({
    metrics: {
        histogram: jest.fn()
    }
}));

describe('Base64Layer', () => {
    let base64Layer;

    beforeEach(() => {
        base64Layer = new Base64Layer();
        jest.clearAllMocks();
    });

    describe('encode', () => {
        it('should encode string data correctly', () => {
            const input = 'Hello, World!';
            const expected = Buffer.from(input).toString('base64');
            const result = base64Layer.encode(input);
            expect(result).toBe(expected);
        });

        it('should encode buffer data correctly', () => {
            const input = Buffer.from('Hello, World!');
            const expected = input.toString('base64');
            const result = base64Layer.encode(input);
            expect(result).toBe(expected);
        });

        it('should handle empty input', () => {
            const input = '';
            const result = base64Layer.encode(input);
            expect(result).toBe('');
        });

        it('should handle large input with chunking', () => {
            const input = Buffer.alloc(1024 * 1024, 'x'); // 1MB of 'x'
            const result = base64Layer.encode(input);
            expect(result).toBe(input.toString('base64'));
        });

        it('should update metrics', () => {
            base64Layer.encode('test');
            expect(base64Layer.metrics.encodeCount).toBe(1);
            expect(base64Layer.metrics.encodeTime).toBeGreaterThan(0);
            expect(metrics.histogram).toHaveBeenCalledWith('base64.encode.time', expect.any(Number));
        });
    });

    describe('decode', () => {
        it('should decode base64 string correctly', () => {
            const input = 'SGVsbG8sIFdvcmxkIQ=='; // "Hello, World!"
            const expected = 'Hello, World!';
            const result = base64Layer.decode(input);
            expect(result.toString()).toBe(expected);
        });

        it('should handle empty input', () => {
            const input = '';
            const result = base64Layer.decode(input);
            expect(result.length).toBe(0);
        });

        it('should handle large input with chunking', () => {
            const original = Buffer.alloc(1024 * 1024, 'x'); // 1MB of 'x'
            const encoded = original.toString('base64');
            const result = base64Layer.decode(encoded);
            expect(result).toEqual(original);
        });

        it('should throw error for invalid base64', () => {
            const input = 'invalid-base64!';
            expect(() => base64Layer.decode(input)).toThrow('Invalid base64 string');
        });

        it('should update metrics', () => {
            base64Layer.decode('SGVsbG8='); // "Hello"
            expect(base64Layer.metrics.decodeCount).toBe(1);
            expect(base64Layer.metrics.decodeTime).toBeGreaterThan(0);
            expect(metrics.histogram).toHaveBeenCalledWith('base64.decode.time', expect.any(Number));
        });
    });

    describe('streaming', () => {
        const streamToBuffer = async (stream) => {
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        };

        describe('createEncodeStream', () => {
            it('should encode streaming data correctly', async () => {
                const input = 'Hello, World!';
                const expected = Buffer.from(input).toString('base64');

                const readStream = Readable.from([Buffer.from(input)]);
                const encodeStream = base64Layer.createEncodeStream();
                readStream.pipe(encodeStream);

                const result = await streamToBuffer(encodeStream);
                expect(result.toString()).toBe(expected);
            });

            it('should handle streaming chunks that are not multiples of 3', async () => {
                const inputs = ['He', 'llo', ' Wo', 'rld!']; // Chunks not aligned to 3 bytes
                const expected = Buffer.from(inputs.join('')).toString('base64');

                const readStream = Readable.from(inputs.map(str => Buffer.from(str)));
                const encodeStream = base64Layer.createEncodeStream();
                readStream.pipe(encodeStream);

                const result = await streamToBuffer(encodeStream);
                expect(result.toString()).toBe(expected);
            });
        });

        describe('createDecodeStream', () => {
            it('should decode streaming data correctly', async () => {
                const original = 'Hello, World!';
                const input = Buffer.from(original).toString('base64');

                const readStream = Readable.from([Buffer.from(input)]);
                const decodeStream = base64Layer.createDecodeStream();
                readStream.pipe(decodeStream);

                const result = await streamToBuffer(decodeStream);
                expect(result.toString()).toBe(original);
            });

            it('should handle streaming chunks that are not multiples of 4', async () => {
                const original = 'Hello, World!';
                const encoded = Buffer.from(original).toString('base64');
                const chunks = [];
                for (let i = 0; i < encoded.length; i += 3) { // Split into chunks of 3
                    chunks.push(encoded.slice(i, i + 3));
                }

                const readStream = Readable.from(chunks.map(str => Buffer.from(str)));
                const decodeStream = base64Layer.createDecodeStream();
                readStream.pipe(decodeStream);

                const result = await streamToBuffer(decodeStream);
                expect(result.toString()).toBe(original);
            });

            it('should throw error for invalid base64 in stream', async () => {
                const input = 'invalid-base64!';
                const readStream = Readable.from([Buffer.from(input)]);
                const decodeStream = base64Layer.createDecodeStream();
                readStream.pipe(decodeStream);

                await expect(streamToBuffer(decodeStream)).rejects.toThrow('Invalid base64 string in stream');
            });
        });
    });

    describe('getMetrics', () => {
        it('should return correct metrics', () => {
            // Perform some operations
            base64Layer.encode('test1');
            base64Layer.encode('test2');
            base64Layer.decode('dGVzdDE='); // "test1"
            base64Layer.createEncodeStream();
            base64Layer.createDecodeStream();

            const metrics = base64Layer.getMetrics();
            expect(metrics).toEqual({
                encodeCount: 2,
                decodeCount: 1,
                encodeTime: expect.any(Number),
                decodeTime: expect.any(Number),
                streamEncodeCount: 1,
                streamDecodeCount: 1,
                averageEncodeTime: expect.any(Number),
                averageDecodeTime: expect.any(Number)
            });
            expect(metrics.averageEncodeTime).toBe(metrics.encodeTime / metrics.encodeCount);
            expect(metrics.averageDecodeTime).toBe(metrics.decodeTime / metrics.decodeCount);
        });

        it('should handle zero counts', () => {
            const metrics = base64Layer.getMetrics();
            expect(metrics.averageEncodeTime).toBe(0);
            expect(metrics.averageDecodeTime).toBe(0);
        });
    });
}); 