/**
 * Priority levels for message batching
 */
const PRIORITY_LEVELS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

/**
 * Message types for the batching system
 */
const MESSAGE_TYPES = {
  DATA: 'data',
  CONTROL: 'control',
  STATUS: 'status'
};

module.exports = {
  PRIORITY_LEVELS,
  MESSAGE_TYPES
}; 