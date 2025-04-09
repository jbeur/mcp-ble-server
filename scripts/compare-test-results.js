const fs = require('fs');

// Read current and previous test results
const currentResults = JSON.parse(fs.readFileSync('.test-results.json', 'utf8'));
const previousResults = JSON.parse(fs.readFileSync('.previous-test-results.json', 'utf8'));

// Compare results
const regressions = [];
currentResults.testResults.forEach(currentSuite => {
  const previousSuite = previousResults.testResults.find(
    s => s.testFilePath === currentSuite.testFilePath
  );
    
  if (!previousSuite) return;

  // Check for newly failing tests
  currentSuite.testResults.forEach(test => {
    const previousTest = previousSuite.testResults.find(
      t => t.fullName === test.fullName
    );
        
    if (previousTest && previousTest.status === 'passed' && test.status === 'failed') {
      regressions.push({
        suite: currentSuite.testFilePath,
        test: test.fullName,
        message: test.failureMessages[0]
      });
    }
  });
});

// Report regressions
if (regressions.length > 0) {
  console.error('\nTest Regressions Detected:');
  regressions.forEach(reg => {
    console.error(`\n${reg.suite}\n  ${reg.test}\n  ${reg.message}`);
  });
  throw new Error('Test regressions detected');
}

// Backup current results for next comparison
fs.copyFileSync('.test-results.json', '.previous-test-results.json'); 