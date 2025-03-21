const fs = require('fs');
const path = require('path');
const winston = require('winston');
const ConfigLoader = require('../../src/config/configLoader');

// Mock winston
jest.mock('winston', () => ({
    format: {
        timestamp: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        simple: jest.fn().mockReturnThis(),
        combine: jest.fn().mockReturnThis()
    },
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn()
    }),
    transports: {
        File: jest.fn(),
        Console: jest.fn()
    }
}));

// Mock fs module
jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    watch: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    stat: jest.fn().mockImplementation((path, callback) => callback(null, { isFile: () => true }))
}));

// Create logs directory for testing
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

describe('ConfigLoader', () => {
    let configLoader;
    const mockConfigPath = '/test/config.yaml';
    const mockConfig = {
        server: {
            host: '127.0.0.1',
            port: 8080
        },
        ble: {
            scan_duration: 5,
            connection_timeout: 10,
            mtu_size: 512
        },
        logging: {
            level: 'info',
            file: 'test.log'
        }
    };

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Mock fs.readFileSync
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));
        
        // Initialize config loader
        configLoader = new ConfigLoader();
    });

    describe('loadConfig', () => {
        it('should load configuration successfully', () => {
            const config = configLoader.loadConfig(mockConfigPath);
            
            expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf8');
            expect(config).toEqual(mockConfig);
        });

        it('should handle invalid YAML', () => {
            fs.readFileSync.mockReturnValue('invalid: yaml: :');
            
            expect(() => configLoader.loadConfig(mockConfigPath)).toThrow();
        });
    });

    describe('validateConfig', () => {
        it('should validate required sections', () => {
            const invalidConfig = {
                server: {},
                ble: {}
            };
            
            configLoader.config = invalidConfig;
            expect(() => configLoader.validateConfig()).toThrow('Missing required configuration section: logging');
        });

        it('should validate BLE configuration', () => {
            const invalidConfig = {
                server: {},
                ble: {
                    scan_duration: 0,
                    connection_timeout: 10,
                    mtu_size: 512
                },
                logging: {
                    level: 'info',
                    file: 'test.log'
                }
            };
            
            configLoader.config = invalidConfig;
            expect(() => configLoader.validateConfig()).toThrow('Invalid scan_duration in BLE configuration');
        });
    });

    describe('file watching', () => {
        it('should set up file watcher', () => {
            configLoader.loadConfig(mockConfigPath);
            
            expect(fs.watch).toHaveBeenCalledWith(mockConfigPath, expect.any(Function));
        });

        it('should handle file changes', () => {
            const newConfig = { ...mockConfig, server: { port: 8081 } };
            fs.readFileSync
                .mockReturnValueOnce(JSON.stringify(mockConfig))
                .mockReturnValueOnce(JSON.stringify(newConfig));

            configLoader.loadConfig(mockConfigPath);
            
            // Simulate file change
            const watcherCallback = fs.watch.mock.calls[0][1];
            watcherCallback('change', 'config.yaml');

            expect(configLoader.getConfig()).toEqual(newConfig);
        });
    });

    describe('stopWatching', () => {
        it('should stop file watcher', () => {
            const mockClose = jest.fn();
            fs.watch.mockReturnValue({ close: mockClose });

            configLoader.loadConfig(mockConfigPath);
            configLoader.stopWatching();

            expect(mockClose).toHaveBeenCalled();
        });
    });
}); 