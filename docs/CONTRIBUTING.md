# Contributing Guidelines

## Overview
This document outlines the guidelines for contributing to the MCP BLE Server project. We welcome contributions from the community and want to ensure a smooth collaboration process.

## Code of Conduct
By participating in this project, you agree to abide by our Code of Conduct. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.

## Getting Started

### Prerequisites
- Node.js >= 14.x
- npm >= 6.x
- Git
- Bluetooth adapter with BLE support
- Linux/macOS (Windows support coming soon)

### Development Setup
1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/mcp-ble-server.git
   cd mcp-ble-server
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Code Style Guide

### JavaScript Style
- Use CommonJS module system
- Follow the [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Example
```javascript
/**
 * Connects to a BLE device with retry mechanism
 * @param {Object} device - Device configuration
 * @param {string} device.name - Device name
 * @param {string} device.address - Device MAC address
 * @param {number} maxAttempts - Maximum connection attempts
 * @returns {Promise<BLEDevice>} Connected device instance
 * @throws {BLEConnectionError} If connection fails
 */
async function connectToDevice(device, maxAttempts = 3) {
  try {
    // Implementation
  } catch (error) {
    throw new BLEConnectionError(error.message, device.id);
  }
}
```

### File Organization
- One class/component per file
- Group related functionality in directories
- Use index.js for exports
- Keep files under 300 lines when possible

### Directory Structure
```
src/
├── ble/           # BLE-related functionality
├── config/        # Configuration management
└── utils/         # Utility functions
```

## Testing Requirements

### Unit Tests
- Write tests for all new features
- Maintain minimum 80% code coverage
- Use Jest for testing
- Mock external dependencies

### Example Test
```javascript
describe('BLEService', () => {
  let bleService;

  beforeEach(() => {
    bleService = new BLEService();
  });

  afterEach(() => {
    bleService.cleanup();
  });

  test('should connect to device', async () => {
    const device = {
      name: 'TestDevice',
      address: '00:11:22:33:44:55'
    };

    await bleService.connectToDevice(device);
    expect(bleService.isConnected(device.id)).toBe(true);
  });
});
```

### Integration Tests
- Test component interactions
- Use real BLE devices when possible
- Test error scenarios
- Verify cleanup

### Running Tests
```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test tests/ble/bleService.test.js
```

## Documentation Requirements

### Code Documentation
- Add JSDoc comments for public APIs
- Document complex algorithms
- Explain non-obvious code
- Keep documentation up to date

### Example
```javascript
/**
 * Implements exponential backoff for retry attempts
 * @param {Function} operation - Operation to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxAttempts - Maximum retry attempts
 * @param {number} options.initialDelay - Initial delay in ms
 * @returns {Promise<any>} Operation result
 */
async function withRetry(operation, options = {}) {
  // Implementation
}
```

### README Updates
- Update README.md for new features
- Add usage examples
- Document configuration changes
- Update dependencies

## Pull Request Process

### Before Submitting
1. Update your fork with latest changes:
   ```bash
   git remote add upstream https://github.com/original/mcp-ble-server.git
   git fetch upstream
   git rebase upstream/main
   ```

2. Run tests and linting:
   ```bash
   npm test
   npm run lint
   ```

3. Update documentation:
   - Add/update JSDoc comments
   - Update README.md if needed
   - Add/update tests

### Pull Request Guidelines
1. Use a clear, descriptive title
2. Provide a detailed description
3. Reference related issues
4. Include test results
5. Add screenshots for UI changes

### Example Pull Request
```markdown
## Description
Adds support for BLE device filtering by service UUID

## Changes
- Added service UUID filtering to device discovery
- Updated configuration schema
- Added tests for service filtering

## Testing
- [x] Unit tests pass
- [x] Integration tests pass
- [x] Manual testing completed

## Screenshots
[Add screenshots if applicable]

## Related Issues
Fixes #123
```

## Review Process

### Code Review Guidelines
1. Review code for:
   - Functionality
   - Code style
   - Test coverage
   - Documentation
   - Performance
   - Security

2. Provide constructive feedback
3. Request changes when needed
4. Approve when satisfied

### Response Time
- Initial review: Within 48 hours
- Follow-up reviews: Within 24 hours
- Merge after approval: Within 24 hours

## Release Process

### Versioning
- Follow [Semantic Versioning](https://semver.org/)
- Update package.json
- Update CHANGELOG.md

### Release Steps
1. Create release branch:
   ```bash
   git checkout -b release/v1.0.0
   ```

2. Update version:
   ```bash
   npm version 1.0.0
   ```

3. Update CHANGELOG.md:
   ```markdown
   # Changelog

   ## [1.0.0] - 2024-03-20
   ### Added
   - Initial release
   - BLE device discovery
   - Connection management
   ```

4. Create pull request
5. Merge after review
6. Create GitHub release

## Communication

### Channels
- GitHub Issues
- Pull Requests
- Discussions
- Email (for security issues)

### Issue Reporting
1. Use issue templates
2. Provide detailed information
3. Include steps to reproduce
4. Add system information

### Security Issues
- Email security@example.com
- Do not create public issues
- Include detailed description
- Wait for response

## Maintenance

### Regular Tasks
1. Update dependencies:
   ```bash
   npm update
   ```

2. Run security audit:
   ```bash
   npm audit
   ```

3. Update documentation
4. Review open issues
5. Clean up stale branches

### Branch Management
- Delete merged feature branches
- Keep main branch clean
- Use meaningful branch names
- Regular cleanup

## Resources

### Documentation
- [API Documentation](docs/API.md)
- [Error Handling Guide](docs/ERROR_HANDLING.md)
- [Configuration Guide](docs/CONFIGURATION.md)
- [Testing Guide](docs/TESTING.md)

### Tools
- ESLint for code linting
- Jest for testing
- Prettier for formatting
- Husky for git hooks

### External Resources
- [Node.js Documentation](https://nodejs.org/docs/)
- [BLE Protocol](https://www.bluetooth.com/specifications/bluetooth-core-specification/)
- [Jest Documentation](https://jestjs.io/docs/getting-started) 