const { logger } = require('../../utils/logger');
const { metrics } = require('../../utils/metrics');

// Circuit breaker states
const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreakerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

class CircuitBreaker {
  constructor(options = {}) {
    this.options = {
      failureThreshold: options.failureThreshold || 5,
      resetTimeout: options.resetTimeout || 60000, // 60 seconds
      halfOpenLimit: options.halfOpenLimit || 1,
      ...options
    };

    // State tracking per connection
    this.states = new Map();
    this.failureCounts = new Map();
    this.lastFailureTime = new Map();
    this.halfOpenRequests = new Map();

    // Initialize metrics
    this.stateGauge = metrics.gauge('circuit_breaker_state', 'Current state of the circuit breaker', ['connection_id']);
    this.failureCounter = metrics.counter('circuit_breaker_failures', 'Number of failures tracked by the circuit breaker', ['connection_id']);
    this.successCounter = metrics.counter('circuit_breaker_successes', 'Number of successful operations', ['connection_id']);
    this.stateTransitions = metrics.counter('circuit_breaker_state_transitions', 'Number of state transitions', ['connection_id', 'from_state', 'to_state']);
  }

  getState(connectionId) {
    if (!this.states.has(connectionId)) {
      this.states.set(connectionId, STATES.CLOSED);
      this.updateStateMetrics(connectionId);
    }

    const state = this.states.get(connectionId);
    const lastFailure = this.lastFailureTime.get(connectionId) || 0;

    // Check if we should transition from OPEN to HALF_OPEN
    if (state === STATES.OPEN && 
        Date.now() - lastFailure >= this.options.resetTimeout) {
      this.transitionState(connectionId, STATES.HALF_OPEN);
      this.halfOpenRequests.set(connectionId, 0);
      return STATES.HALF_OPEN;
    }

    return state;
  }

  allowRequest(connectionId) {
    const state = this.getState(connectionId);

    switch (state) {
      case STATES.CLOSED:
        return true;
      case STATES.OPEN:
        return false;
      case STATES.HALF_OPEN:
        const requests = this.halfOpenRequests.get(connectionId) || 0;
        if (requests < this.options.halfOpenLimit) {
          this.halfOpenRequests.set(connectionId, requests + 1);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  async execute(connectionId, operation) {
    if (!this.allowRequest(connectionId)) {
      throw new CircuitBreakerError('Circuit breaker is open');
    }

    try {
      const result = await operation();
      this.recordSuccess(connectionId);
      return result;
    } catch (error) {
      this.recordFailure(connectionId, error);
      throw error;
    }
  }

  recordSuccess(connectionId) {
    const state = this.getState(connectionId);

    // Reset failure count
    this.failureCounts.set(connectionId, 0);

    // Track success metric
    this.successCounter.inc({ connection_id: connectionId });

    // If in HALF_OPEN, transition to CLOSED after success
    if (state === STATES.HALF_OPEN) {
      this.transitionState(connectionId, STATES.CLOSED);
    }

    this.updateStateMetrics(connectionId);
  }

  recordFailure(connectionId, error) {
    const currentCount = this.failureCounts.get(connectionId) || 0;
    const newCount = currentCount + 1;
    this.failureCounts.set(connectionId, newCount);
    this.lastFailureTime.set(connectionId, Date.now());

    // Track failure metric
    this.failureCounter.inc({ connection_id: connectionId });

    // Log failure
    logger.error('Circuit breaker operation failed', {
      connectionId,
      error: error ? error.message : 'Unknown error'
    });

    // Check if we should open the circuit
    if (newCount >= this.options.failureThreshold) {
      this.transitionState(connectionId, STATES.OPEN);
    }

    this.updateStateMetrics(connectionId);
  }

  transitionState(connectionId, newState) {
    const oldState = this.states.get(connectionId) || STATES.CLOSED;
    
    if (oldState !== newState) {
      this.states.set(connectionId, newState);
      
      // Track state transition
      this.stateTransitions.inc({
        connection_id: connectionId,
        from_state: oldState,
        to_state: newState
      });

      // Log state change
      logger.info('Circuit breaker state changed', {
        connectionId,
        fromState: oldState,
        toState: newState
      });

      this.updateStateMetrics(connectionId);
    }
  }

  updateStateMetrics(connectionId) {
    const state = this.states.get(connectionId);
    const stateValue = state === STATES.CLOSED ? 0 : 
                      state === STATES.HALF_OPEN ? 1 : 2;
    
    this.stateGauge.set({ connection_id: connectionId }, stateValue);
  }

  reset(connectionId) {
    this.states.set(connectionId, STATES.CLOSED);
    this.failureCounts.set(connectionId, 0);
    this.lastFailureTime.delete(connectionId);
    this.halfOpenRequests.delete(connectionId);
    this.updateStateMetrics(connectionId);
  }
}

module.exports = CircuitBreaker; 