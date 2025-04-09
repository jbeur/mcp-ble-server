const fs = require('fs');
const path = require('path');

// Common Chai to Jest assertion mappings
const assertionMappings = {
  'expect\\(([^)]+)\\)\\.to\\.equal\\(([^)]+)\\)': 'expect($1).toBe($2)',
  'expect\\(([^)]+)\\)\\.to\\.deep\\.equal\\(([^)]+)\\)': 'expect($1).toEqual($2)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.true': 'expect($1).toBe(true)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.false': 'expect($1).toBe(false)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.null': 'expect($1).toBeNull()',
  'expect\\(([^)]+)\\)\\.to\\.be\\.undefined': 'expect($1).toBeUndefined()',
  'expect\\(([^)]+)\\)\\.to\\.be\\.defined': 'expect($1).toBeDefined()',
  'expect\\(([^)]+)\\)\\.to\\.be\\.a\\(([^)]+)\\)': 'expect(typeof $1).toBe($2)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.an\\(([^)]+)\\)': 'expect(typeof $1).toBe($2)',
  'expect\\(([^)]+)\\)\\.to\\.have\\.length\\.of\\(([^)]+)\\)': 'expect($1).toHaveLength($2)',
  'expect\\(([^)]+)\\)\\.to\\.include\\(([^)]+)\\)': 'expect($1).toContain($2)',
  'expect\\(([^)]+)\\)\\.to\\.throw\\(([^)]*)\\)': 'expect($1).toThrow($2)',
  'expect\\(([^)]+)\\)\\.to\\.match\\(([^)]+)\\)': 'expect($1).toMatch($2)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.greaterThan\\(([^)]+)\\)': 'expect($1).toBeGreaterThan($2)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.lessThan\\(([^)]+)\\)': 'expect($1).toBeLessThan($2)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.closeTo\\(([^)]+),\\s*([^)]+)\\)': 'expect($1).toBeCloseTo($2, $3)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.instanceOf\\(([^)]+)\\)': 'expect($1).toBeInstanceOf($2)',
  'expect\\(([^)]+)\\)\\.to\\.have\\.property\\(([^)]+)\\)': 'expect($1).toHaveProperty($2)',
  'expect\\(([^)]+)\\)\\.to\\.have\\.property\\(([^)]+),\\s*([^)]+)\\)': 'expect($1).toHaveProperty($2, $3)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.empty': 'expect($1).toHaveLength(0)',
  'expect\\(([^)]+)\\)\\.to\\.be\\.ok': 'expect($1).toBeTruthy()',
  'expect\\(([^)]+)\\)\\.to\\.be\\.not\\.ok': 'expect($1).toBeFalsy()',
  'expect\\(([^)]+)\\)\\.to\\.be\\.within\\(([^)]+),\\s*([^)]+)\\)': 'expect($1).toBeGreaterThanOrEqual($2); expect($1).toBeLessThanOrEqual($3)'
};

// Files to update
const filesToUpdate = [
  'tests/unit/mcp/handlers/ConnectionHandler.test.js',
  'tests/unit/mcp/protocol/base64.test.js',
  'tests/security/VulnerabilityScanner.test.js',
  'tests/unit/mcp/handlers/ScanHandler.test.js',
  'tests/unit/websocket/WebSocketServer.test.js',
  'tests/unit/utils/Base64Utils.test.js'
];

function updateTestFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Remove Chai import
    content = content.replace(/const\s*{\s*expect\s*}\s*=\s*require\('chai'\);\n?/g, '');
    
    // Convert assertions
    for (const [chaiPattern, jestReplacement] of Object.entries(assertionMappings)) {
      const regex = new RegExp(chaiPattern, 'g');
      content = content.replace(regex, jestReplacement);
    }
    
    // Add Jest setup if not present
    if (!content.includes('jest.mock')) {
      const setupCode = `
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
`;
      content = setupCode + content;
    }
    
    // Write updated content
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${filePath}`);
  } catch (error) {
    console.error(`Error updating ${filePath}:`, error);
  }
}

// Update all files
filesToUpdate.forEach(updateTestFile);

console.log('Test file conversion complete!'); 