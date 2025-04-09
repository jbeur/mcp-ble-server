const ScalingRecommendations = require('../../../src/metrics/scalingRecommendations');
const { metrics } = require('../../../src/metrics/metrics');

describe('ScalingRecommendations', () => {
  let scalingRecommendations;
  let originalDateNow;

  beforeEach(() => {
    originalDateNow = Date.now;
    const currentTime = 1000000;
    Date.now = jest.fn(() => currentTime);
        
    scalingRecommendations = new ScalingRecommendations({
      memoryThreshold: 80,
      cpuThreshold: 80,
      networkThreshold: 80,
      minScalingInterval: 300
    });
    metrics.reset();
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  describe('generateRecommendations', () => {
    it('should return null when predictions are invalid', () => {
      const result = scalingRecommendations.generateRecommendations(null);
      expect(result).toBeNull();
      expect(metrics.getCounter('scaling_recommendations_errors')).toBe(1);
    });

    it('should return null when no thresholds are exceeded', () => {
      const predictions = {
        memory: 70,
        cpu: 75,
        network: 60
      };
      const result = scalingRecommendations.generateRecommendations(predictions);
      expect(result).toBeNull();
    });

    it('should generate recommendations when memory threshold is exceeded', () => {
      const predictions = {
        memory: 85,
        cpu: 75,
        network: 60
      };
      const result = scalingRecommendations.generateRecommendations(predictions);
      expect(result).not.toBeNull();
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('memory');
      expect(result.actions[0].action).toBe('scale_up');
      expect(result.reason).toContain('High memory usage predicted');
      expect(metrics.getCounter('scaling_recommendations_generated')).toBe(1);
    });

    it('should generate recommendations when multiple thresholds are exceeded', () => {
      const predictions = {
        memory: 85,
        cpu: 85,
        network: 85
      };
      const result = scalingRecommendations.generateRecommendations(predictions);
      expect(result).not.toBeNull();
      expect(result.actions).toHaveLength(3);
      expect(result.reason).toHaveLength(3);
    });

    it('should respect minimum scaling interval', () => {
      const predictions = {
        memory: 85,
        cpu: 75,
        network: 60
      };
      const result1 = scalingRecommendations.generateRecommendations(predictions);
      const result2 = scalingRecommendations.generateRecommendations(predictions);
      expect(result1).not.toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe('getRecentRecommendations', () => {
    it('should return empty array when no recommendations exist', () => {
      const recommendations = scalingRecommendations.getRecentRecommendations();
      expect(recommendations).toHaveLength(0);
    });

    it('should return recent recommendations with limit', () => {
      const predictions = {
        memory: 85,
        cpu: 85,
        network: 85
      };

      // Generate 15 recommendations by advancing time
      for (let i = 0; i < 15; i++) {
        Date.now.mockReturnValue(1000000 + (i * 301 * 1000)); // Advance time by more than minScalingInterval
        scalingRecommendations.generateRecommendations(predictions);
      }

      const recommendations = scalingRecommendations.getRecentRecommendations(5);
      expect(recommendations).toHaveLength(5);
            
      // Verify recommendations are ordered by timestamp
      for (let i = 1; i < recommendations.length; i++) {
        expect(recommendations[i].timestamp).toBeGreaterThan(recommendations[i-1].timestamp);
      }
    });
  });

  describe('clearRecommendations', () => {
    it('should clear all recommendations', () => {
      const predictions = {
        memory: 85,
        cpu: 75,
        network: 60
      };
      scalingRecommendations.generateRecommendations(predictions);
      scalingRecommendations.clearRecommendations();
      const recommendations = scalingRecommendations.getRecentRecommendations();
      expect(recommendations).toHaveLength(0);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration values', () => {
      const newConfig = {
        memoryThreshold: 90,
        cpuThreshold: 90,
        networkThreshold: 90
      };
      scalingRecommendations.updateConfig(newConfig);
      const predictions = {
        memory: 85,
        cpu: 85,
        network: 85
      };
      const result = scalingRecommendations.generateRecommendations(predictions);
      expect(result).toBeNull();
    });
  });
}); 