const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');

function verifyBuild() {
  const distPath = path.join(process.cwd(), 'dist');
  const requiredFiles = [
    'package.json',
    'ecosystem.config.js',
    'index.js',
    'node_modules'
  ];

  logger.info('Verifying build output...');

  // Check if dist directory exists
  if (!fs.existsSync(distPath)) {
    throw new Error('Build failed: dist directory not found');
  }

  // Verify required files
  for (const file of requiredFiles) {
    const filePath = path.join(distPath, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Build failed: ${file} not found in dist directory`);
    }
  }

  // Verify package.json has correct dependencies
  const packageJson = require(path.join(distPath, 'package.json'));
  if (!packageJson.dependencies) {
    throw new Error('Build failed: package.json missing dependencies');
  }

  // Verify node_modules contains production dependencies
  const nodeModulesPath = path.join(distPath, 'node_modules');
  const installedModules = fs.readdirSync(nodeModulesPath)
    .filter(file => !file.startsWith('.'));

  const missingDeps = Object.keys(packageJson.dependencies)
    .filter(dep => !installedModules.includes(dep));

  if (missingDeps.length > 0) {
    throw new Error(`Build failed: missing dependencies: ${missingDeps.join(', ')}`);
  }

  // Verify transpiled files
  const srcFiles = fs.readdirSync(path.join(process.cwd(), 'src'))
    .filter(file => file.endsWith('.js'));
  const distFiles = fs.readdirSync(distPath)
    .filter(file => file.endsWith('.js'));

  const missingFiles = srcFiles
    .filter(file => !distFiles.includes(file));

  if (missingFiles.length > 0) {
    throw new Error(`Build failed: missing transpiled files: ${missingFiles.join(', ')}`);
  }

  logger.info('Build verification completed successfully');
  return true;
}

try {
  const success = verifyBuild();
  if (!success) {
    throw new Error('Build verification failed');
  }
} catch (error) {
  logger.error(error.message);
  throw error;
} 