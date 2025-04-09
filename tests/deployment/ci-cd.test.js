const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

describe('CI/CD Pipeline Configuration', () => {
  let workflowConfig;

  beforeAll(() => {
    const workflowPath = path.join(__dirname, '../../.github/workflows/ci-cd.yml');
    const workflowContent = fs.readFileSync(workflowPath, 'utf8');
    workflowConfig = yaml.load(workflowContent);
  });

  test('workflow file exists', () => {
    const workflowPath = path.join(__dirname, '../../.github/workflows/ci-cd.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  test('workflow triggers are configured correctly', () => {
    expect(workflowConfig.on).toBeDefined();
    expect(workflowConfig.on.push).toBeDefined();
    expect(workflowConfig.on.push.branches).toContain('main');
    expect(workflowConfig.on.pull_request).toBeDefined();
    expect(workflowConfig.on.pull_request.branches).toContain('main');
  });

  test('all required jobs are present', () => {
    const requiredJobs = ['test', 'lint', 'security', 'build', 'deploy'];
    const jobs = Object.keys(workflowConfig.jobs);
    requiredJobs.forEach(job => {
      expect(jobs).toContain(job);
    });
  });

  test('test job configuration', () => {
    const testJob = workflowConfig.jobs.test;
    expect(testJob['runs-on']).toBe('ubuntu-latest');
    expect(testJob.steps).toBeDefined();
    expect(testJob.steps.length).toBeGreaterThan(0);
  });

  test('lint job configuration', () => {
    const lintJob = workflowConfig.jobs.lint;
    expect(lintJob['runs-on']).toBe('ubuntu-latest');
    expect(lintJob.steps).toBeDefined();
    expect(lintJob.steps.length).toBeGreaterThan(0);
  });

  test('security job configuration', () => {
    const securityJob = workflowConfig.jobs.security;
    expect(securityJob['runs-on']).toBe('ubuntu-latest');
    expect(securityJob.steps).toBeDefined();
    expect(securityJob.steps.length).toBeGreaterThan(0);
  });

  test('build job configuration', () => {
    const buildJob = workflowConfig.jobs.build;
    expect(buildJob['runs-on']).toBe('ubuntu-latest');
    expect(buildJob.needs).toBeDefined();
    expect(buildJob.steps).toBeDefined();
    expect(buildJob.steps.length).toBeGreaterThan(0);
  });

  test('deploy job configuration', () => {
    const deployJob = workflowConfig.jobs.deploy;
    expect(deployJob['runs-on']).toBe('ubuntu-latest');
    expect(deployJob.needs).toBe('build');
    expect(deployJob.if).toBe('github.ref == \'refs/heads/main\'');
    expect(deployJob.environment).toBeDefined();
    expect(deployJob.steps).toBeDefined();
    expect(deployJob.steps.length).toBeGreaterThan(0);
  });

  test('required secrets are defined', () => {
    const deployJob = workflowConfig.jobs.deploy;
    const deployStep = deployJob.steps.find(step => step.name === 'Deploy to production');
    expect(deployStep.env).toBeDefined();
    expect(deployStep.env.DEPLOY_KEY).toBeDefined();
  });
}); 