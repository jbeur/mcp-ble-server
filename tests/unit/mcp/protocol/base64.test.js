const { expect } = require('chai');
const { Buffer } = require('buffer');

describe('Base64 Operations', () => {
    describe('Encoding', () => {
        it('should encode empty buffer correctly', () => {
            const buffer = Buffer.from('');
            const encoded = buffer.toString('base64');
            expect(encoded).to.equal('');
        });

        it('should encode simple string correctly', () => {
            const buffer = Buffer.from('Hello World');
            const encoded = buffer.toString('base64');
            expect(encoded).to.equal('SGVsbG8gV29ybGQ=');
        });

        it('should encode binary data correctly', () => {
            const buffer = Buffer.from([0x00, 0xFF, 0x42, 0x7F]);
            const encoded = buffer.toString('base64');
            expect(encoded).to.equal('AP9Cfw==');
        });

        it('should handle large data sets', () => {
            const largeBuffer = Buffer.alloc(1024 * 1024); // 1MB buffer
            const encoded = largeBuffer.toString('base64');
            expect(encoded.length).to.be.greaterThan(0);
            expect(encoded).to.match(/^[A-Za-z0-9+/]*={0,2}$/);
        });
    });

    describe('Decoding', () => {
        it('should decode empty string correctly', () => {
            const decoded = Buffer.from('', 'base64');
            expect(decoded.length).to.equal(0);
        });

        it('should decode simple string correctly', () => {
            const decoded = Buffer.from('SGVsbG8gV29ybGQ=', 'base64');
            expect(decoded.toString()).to.equal('Hello World');
        });

        it('should decode binary data correctly', () => {
            const decoded = Buffer.from('AP9Cfw==', 'base64');
            expect(decoded).to.deep.equal(Buffer.from([0x00, 0xFF, 0x42, 0x7F]));
        });

        it('should handle large data sets', () => {
            const largeString = 'A'.repeat(1024 * 1024); // 1MB string
            const decoded = Buffer.from(largeString, 'base64');
            expect(decoded.length).to.be.greaterThan(0);
        });
    });

    describe('Validation', () => {
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
                expect(() => Buffer.from(str, 'base64')).to.not.throw();
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
                expect(() => Buffer.from(str, 'base64')).to.throw();
            });
        });

        it('should handle padding correctly', () => {
            const testCases = [
                { input: 'SGVsbG8gV29ybGQ=', expected: 'Hello World' },
                { input: 'SGVsbG8gV29ybGQ', expected: 'Hello World' },
                { input: 'SGVsbG8gV29ybGQ==', expected: 'Hello World' }
            ];

            testCases.forEach(({ input, expected }) => {
                const decoded = Buffer.from(input, 'base64');
                expect(decoded.toString()).to.equal(expected);
            });
        });
    });

    describe('Performance', () => {
        it('should handle encoding/decoding of large buffers efficiently', () => {
            const sizes = [1024, 1024 * 10, 1024 * 100]; // 1KB, 10KB, 100KB
            const iterations = 100;

            sizes.forEach(size => {
                const buffer = Buffer.alloc(size);
                const startTime = process.hrtime();

                for (let i = 0; i < iterations; i++) {
                    const encoded = buffer.toString('base64');
                    const decoded = Buffer.from(encoded, 'base64');
                }

                const [seconds, nanoseconds] = process.hrtime(startTime);
                const totalTime = seconds * 1000 + nanoseconds / 1000000;
                const avgTime = totalTime / iterations;

                console.log(`Size: ${size} bytes, Average time: ${avgTime.toFixed(2)}ms`);
                expect(avgTime).to.be.lessThan(10); // Should complete within 10ms per iteration
            });
        });
    });
}); 