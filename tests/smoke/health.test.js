const request = require('supertest');

describe('Health Check Smoke Tests', () => {
  const baseUrl = process.env.TEST_URL || 'http://localhost:3000';

  test('should return 200 and healthy status', async () => {
    const response = await request(baseUrl)
      .get('/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      status: 'healthy',
      version: expect.any(String),
      timestamp: expect.any(String)
    });
  });

  test('should return 200 for metrics endpoint', async () => {
    const response = await request(baseUrl)
      .get('/metrics')
      .expect('Content-Type', /text/)
      .expect(200);

    expect(response.text).toContain('nodejs_version_info');
  });

  test('should return 404 for non-existent endpoint', async () => {
    await request(baseUrl)
      .get('/non-existent')
      .expect(404);
  });
}); 