// Critical paths that must pass for CI/CD
const criticalPaths = [
  'tests/unit/ble/bleService.test.js',
  'tests/unit/ble/ConnectionPool.test.js',
  'tests/unit/ble/ConnectionParameters.test.js',
  'tests/unit/mcp/server/MessageBatcher.test.js',
  'tests/unit/security/Authentication.test.js',
  'tests/unit/security/Encryption.test.js',
  'tests/unit/utils/Base64Utils.test.js'
];

// Failing tests that need to be fixed
const failingPaths = [
  'tests/unit/ble/DeviceDiscoveryOptimization.test.js',
  'tests/unit/ble/DataTransferOptimization.test.js'
];

// Work in progress tests that are not yet stable
const wipPaths = [
  'tests/unit/ble/PriorityQueuing.test.js',
  'tests/unit/ble/PriorityScanning.test.js',
  'tests/unit/ble/RSSIThresholds.test.js',
  'tests/unit/ble/PowerLevelAdjustment.test.js'
];

module.exports = {
  criticalPaths,
  failingPaths,
  wipPaths
}; 