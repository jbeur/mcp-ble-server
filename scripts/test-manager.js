const fs = require('fs');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const testCategories = require('../tests/test-categories');

function pathToPattern(path) {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateFailingTests() {
  try {
    console.log('Running tests to identify failing tests...');
    
    // Run Jest with JSON reporter to get test results
    const result = execSync('npx jest --json --outputFile=test-results.json', { 
      encoding: 'utf8',
      stdio: 'inherit' // Show test output
    });
    
    if (!fs.existsSync('test-results.json')) {
      throw new Error('Test results file not generated');
    }
    
    const testResults = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));
    
    // Extract failing test paths
    const failingTests = testResults.testResults
      .filter(result => result.numFailingTests > 0)
      .map(result => result.testFilePath);
    
    console.log(`Found ${failingTests.length} failing tests`);
    
    // Update test-categories.js
    const categoriesContent = fs.readFileSync('tests/test-categories.js', 'utf8');
    const updatedContent = categoriesContent.replace(
      /failingPaths: \[([\s\S]*?)\]/,
      `failingPaths: [\n    ${failingTests.map(path => `'${path}'`).join(',\n    ')}\n  ]`
    );
    
    fs.writeFileSync('tests/test-categories.js', updatedContent);
    console.log('Updated failing tests list in tests/test-categories.js');
    
    // Clean up
    if (fs.existsSync('test-results.json')) {
      fs.unlinkSync('test-results.json');
    }
  } catch (error) {
    console.error('Error updating failing tests:', error.message);
    throw error;
  }
}

function generateTestReport() {
  try {
    const report = {
      criticalTests: testCategories.criticalPaths.length,
      failingTests: testCategories.failingPaths.length,
      wipTests: testCategories.wipPaths.length,
      timestamp: new Date().toISOString(),
      criticalTestPaths: testCategories.criticalPaths,
      failingTestPaths: testCategories.failingPaths,
      wipTestPaths: testCategories.wipPaths
    };
    
    fs.writeFileSync('test-report.json', JSON.stringify(report, null, 2));
    console.log('Generated test report in test-report.json');
    console.log(`Critical Tests: ${report.criticalTests}`);
    console.log(`Failing Tests: ${report.failingTests}`);
    console.log(`WIP Tests: ${report.wipTests}`);
  } catch (error) {
    console.error('Error generating test report:', error.message);
    throw error;
  }
}

async function runTests(testPattern) {
  try {
    const command = `npm test -- ${testPattern}`;
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
      throw new Error(stderr);
    }
    
    return stdout;
  } catch (error) {
    throw new Error(`Test execution failed: ${error.message}`);
  }
}

async function main() {
  try {
    const testPattern = process.argv[2];
    if (!testPattern) {
      throw new Error('Test pattern is required');
    }

    const output = await runTests(testPattern);
    console.log(output);
  } catch (error) {
    console.error('Error running tests:', error);
    throw error;
  }
}

main(); 