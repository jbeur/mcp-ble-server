const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const winston = require('winston');

class ConfigLoader {
    constructor() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.File({ filename: 'logs/config-error.log', level: 'error' }),
                new winston.transports.Console({
                    format: winston.format.simple()
                })
            ]
        });

        this.config = null;
        this.watcher = null;
    }

    loadConfig(configPath) {
        try {
            this.logger.info(`Loading configuration from: ${configPath}`);
            
            // Read and parse YAML file
            const configFile = fs.readFileSync(configPath, 'utf8');
            this.config = yaml.load(configFile);

            // Validate configuration
            this.validateConfig();

            // Set up file watching for hot-reload
            this.setupFileWatcher(configPath);

            this.logger.info('Configuration loaded successfully');
            return this.config;
        } catch (error) {
            this.logger.error('Failed to load configuration:', error);
            throw error;
        }
    }

    validateConfig() {
        try {
            // Validate required sections
            const requiredSections = ['server', 'ble', 'logging'];
            for (const section of requiredSections) {
                if (!this.config[section]) {
                    throw new Error(`Missing required configuration section: ${section}`);
                }
            }

            // Validate BLE configuration
            const bleConfig = this.config.ble;
            if (!bleConfig.scan_duration || bleConfig.scan_duration <= 0) {
                throw new Error('Invalid scan_duration in BLE configuration');
            }
            if (!bleConfig.connection_timeout || bleConfig.connection_timeout <= 0) {
                throw new Error('Invalid connection_timeout in BLE configuration');
            }
            if (!bleConfig.mtu_size || bleConfig.mtu_size <= 0) {
                throw new Error('Invalid mtu_size in BLE configuration');
            }

            // Validate logging configuration
            const loggingConfig = this.config.logging;
            if (!loggingConfig.level) {
                throw new Error('Missing logging level in configuration');
            }
            if (!loggingConfig.file) {
                throw new Error('Missing logging file path in configuration');
            }

            this.logger.info('Configuration validation successful');
        } catch (error) {
            this.logger.error('Configuration validation failed:', error);
            throw error;
        }
    }

    setupFileWatcher(configPath) {
        try {
            // Stop existing watcher if any
            if (this.watcher) {
                this.watcher.close();
            }

            // Set up new watcher
            this.watcher = fs.watch(configPath, (eventType, filename) => {
                if (eventType === 'change') {
                    this.logger.info(`Configuration file changed: ${filename}`);
                    this.loadConfig(configPath);
                }
            });

            this.logger.info('Configuration file watcher set up successfully');
        } catch (error) {
            this.logger.error('Failed to set up configuration file watcher:', error);
        }
    }

    getConfig() {
        if (!this.config) {
            throw new Error('Configuration not loaded');
        }
        return this.config;
    }

    stopWatching() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
            this.logger.info('Configuration file watcher stopped');
        }
    }
}

module.exports = ConfigLoader; 