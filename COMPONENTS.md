# MCP BLE Server Components

## Core Components

### Base64Utils
- **Location**: `src/utils/Base64Utils.js`
- **Usage**: 
  - Encoding/decoding data for BLE communication
  - Stream processing of base64 data
  - Hardware-accelerated base64 operations
- **Dependencies**:
  - `logger` - For error logging
  - `metrics` - For performance monitoring
  - `Buffer` - For binary data handling
- **Features**:
  - Hardware acceleration support
  - Stream-based encoding/decoding
  - Input validation
  - Whitespace handling
  - Error handling with metrics
- **Test Coverage**: 100% (22 passing tests)
  - Hardware acceleration tests
  - Encoding/decoding tests
  - Validation tests
  - Stream operation tests

### Connection Manager
- **Location**: `src/connection-manager.js`
- **Usage**: Managing BLE connections
- **Status**: Pending implementation

### BLE Server
- **Location**: `src/ble-server.js`
- **Usage**: Core BLE server functionality
- **Status**: Pending implementation

## Utility Components

### Logger
- **Location**: `src/utils/logger.js`
- **Usage**: Centralized logging
- **Status**: Pending implementation

### Metrics
- **Location**: `src/utils/metrics.js`
- **Usage**: Performance monitoring
- **Status**: Pending implementation

## Security Components

### Authentication
- **Location**: `src/security/auth.js`
- **Usage**: Device authentication
- **Status**: Pending implementation

### Encryption
- **Location**: `src/security/encryption.js`
- **Usage**: Data encryption
- **Status**: Pending implementation

## WebSocket Components

### WebSocket Server
- **Location**: `src/websocket/server.js`
- **Usage**: WebSocket communication
- **Status**: Pending implementation

### WebSocket Client
- **Location**: `src/websocket/client.js`
- **Usage**: WebSocket client handling
- **Status**: Pending implementation 