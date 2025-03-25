const { EventEmitter } = require('events');

class MockWebSocket extends EventEmitter {
  constructor(url, protocols = []) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0; // CONNECTING
    this.bufferedAmount = 0;
    this.binaryType = 'nodebuffer';
    this._messageQueue = [];
    this._isConnected = false;
  }

  send(data) {
    if (this.readyState !== 1) { // OPEN
      throw new Error('WebSocket is not connected');
    }
    this.bufferedAmount += data.length;
    this._messageQueue.push(data);
    this.emit('send', data);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 2 || this.readyState === 3) { // CLOSING or CLOSED
      return;
    }

    this.readyState = 2; // CLOSING
    this.emit('close', { code, reason });
    
    // Simulate close completion
    process.nextTick(() => {
      this.readyState = 3; // CLOSED
      this._isConnected = false;
      this.emit('close', { code, reason });
    });
  }

  terminate() {
    this.close(1006, 'Connection terminated');
  }

  ping(data) {
    if (this.readyState !== 1) { // OPEN
      throw new Error('WebSocket is not connected');
    }
    this.emit('ping', data);
  }

  pong(data) {
    if (this.readyState !== 1) { // OPEN
      throw new Error('WebSocket is not connected');
    }
    this.emit('pong', data);
  }

  // Helper methods for testing
  connect() {
    this.readyState = 1; // OPEN
    this._isConnected = true;
    this.emit('open');
  }

  disconnect() {
    this.close(1000, 'Normal closure');
  }

  simulateMessage(data) {
    if (this.readyState !== 1) { // OPEN
      throw new Error('WebSocket is not connected');
    }
    this.emit('message', data);
  }

  simulateError(error) {
    this.emit('error', error);
  }

  cleanup() {
    this.removeAllListeners();
    this._messageQueue = [];
    this._isConnected = false;
    this.readyState = 3; // CLOSED
  }

  // Getters
  get isConnected() {
    return this._isConnected;
  }

  get messageQueue() {
    return [...this._messageQueue];
  }
}

class MockWebSocketServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.clients = new Set();
    this._isListening = false;
  }

  handleUpgrade(request, socket, head) {
    const protocols = request.headers && request.headers['sec-websocket-protocol'] 
      ? request.headers['sec-websocket-protocol'].split(', ')
      : [];
    const ws = new MockWebSocket(request.url, protocols);
    this.clients.add(ws);
    
    // Simulate connection
    process.nextTick(() => {
      ws.connect();
      this.emit('connection', ws);
    });
  }

  emit(event, ...args) {
    super.emit(event, ...args);
    if (event === 'connection') {
      const ws = args[0];
      ws.on('close', () => {
        this.clients.delete(ws);
      });
    }
  }

  close(callback) {
    this._isListening = false;
    const closePromises = Array.from(this.clients).map(client => {
      return new Promise(resolve => {
        client.once('close', resolve);
        client.close();
      });
    });

    Promise.all(closePromises)
      .then(() => {
        this.clients.clear();
        this.emit('close');
        if (callback) callback();
      })
      .catch(error => {
        if (callback) callback(error);
      });
  }

  simulateError(error) {
    this.emit('error', error);
  }

  cleanup() {
    this.removeAllListeners();
    this.close();
  }

  // Getters
  get isListening() {
    return this._isListening;
  }

  get clientCount() {
    return this.clients.size;
  }
}

module.exports = {
  MockWebSocket,
  MockWebSocketServer
}; 