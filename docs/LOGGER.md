# Logger Documentation

## Overview
The Logger class provides a configurable logging system for the MCP BLE Server. It supports multiple log levels, environment-specific formatting, and configuration validation.

## Features
- Multiple log levels (error, warn, info, debug)
- Environment-specific formatting
- Timestamp inclusion in all logs
- Configuration validation
- Log level filtering

## Usage

### Basic Usage
```javascript
const { logger } = require('../utils/logger');

// Basic logging
logger.info('Server started');
logger.error('Connection failed', error);
logger.warn('Resource usage high');
logger.debug('Processing request', requestData);
```

### Custom Logger Instance
```javascript
const { Logger } = require('../utils/logger');

const customLogger = new Logger({
  level: 'debug',
  environment: 'development'
});
```

## Configuration

### Log Levels
Log levels in order of severity (highest to lowest):
1. `error` - Critical issues that need immediate attention
2. `warn` - Warning conditions that should be reviewed
3. `info` - General informational messages (default)
4. `debug` - Detailed debugging information

Messages are logged if their level is equal to or more severe than the configured level.

### Environments
Supported environments:
- `development` (default)
- `test`
- `production`

### Configuration Options
```javascript
{
  level: string,       // One of: 'error', 'warn', 'info', 'debug'
  environment: string  // One of: 'development', 'test', 'production'
}
```

## Message Format
Log messages follow this format:
```
[TIMESTAMP] LEVEL: message
```

In test environment:
```
[TIMESTAMP] [TEST] LEVEL: message
```

## Error Handling
- Invalid log levels throw an error with available options
- Invalid environments throw an error with available options
- Configuration validation occurs during logger initialization

## Examples

### Different Log Levels
```javascript
const { Logger } = require('../utils/logger');

// Only log error and warn messages
const productionLogger = new Logger({
  level: 'warn',
  environment: 'production'
});

// Will be logged (level <= warn)
productionLogger.error('Critical error');
productionLogger.warn('Warning message');

// Won't be logged (level > warn)
productionLogger.info('Info message');
productionLogger.debug('Debug message');
```

### Environment-Specific Logging
```javascript
const { Logger } = require('../utils/logger');

// Test environment logger
const testLogger = new Logger({
  environment: 'test'
});

// Will include [TEST] prefix
testLogger.info('Running test suite');
// Output: [2024-01-20T10:30:00.000Z] [TEST] INFO: Running test suite
```

## Best Practices
1. Use appropriate log levels:
   - `error`: For errors that need immediate attention
   - `warn`: For warning conditions that should be reviewed
   - `info`: For general operational information
   - `debug`: For detailed debugging information

2. Include relevant context in log messages:
   ```javascript
   logger.error('Database connection failed', {
     host: dbHost,
     port: dbPort,
     error: err.message
   });
   ```

3. Configure log level based on environment:
   - Production: 'warn' or 'error'
   - Development: 'info' or 'debug'
   - Testing: Based on test requirements

4. Handle errors appropriately:
   ```javascript
   try {
     // ... operation ...
   } catch (error) {
     logger.error('Operation failed', {
       operation: 'description',
       error: error.message,
       stack: error.stack
     });
   }
   ``` 