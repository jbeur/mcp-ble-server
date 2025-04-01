const noble = require('@abandonware/noble');
const { EventEmitter } = require('events');

class MockDevice extends EventEmitter {
  constructor(id, name, services = []) {
    super();
    this.id = id;
    this.name = name;
    this.services = services;
    this.isConnected = false;
    this.characteristics = new Map();
    this._disconnectTimer = null;
  }

  connect() {
    return new Promise((resolve) => {
      this.isConnected = true;
      resolve();
    });
  }

  disconnect() {
    return new Promise((resolve) => {
      this._disconnectTimer = setTimeout(() => {
        this.isConnected = false;
        this.emit('disconnect');
        resolve();
      }, 0);
    });
  }

  cleanup() {
    if (this._disconnectTimer) {
      clearTimeout(this._disconnectTimer);
      this._disconnectTimer = null;
    }
    this.removeAllListeners();
    this.services.forEach(service => service.cleanup());
  }

  discoverServices() {
    return new Promise((resolve) => {
      resolve(this.services);
    });
  }

  addService(service) {
    this.services.push(service);
  }

  addCharacteristic(serviceId, characteristic) {
    if (!this.characteristics.has(serviceId)) {
      this.characteristics.set(serviceId, new Map());
    }
    this.characteristics.get(serviceId).set(characteristic.uuid, characteristic);
  }
}

class MockService extends EventEmitter {
  constructor(uuid, characteristics = []) {
    super();
    this.uuid = uuid;
    this.characteristics = characteristics;
  }

  cleanup() {
    this.removeAllListeners();
    this.characteristics.forEach(characteristic => characteristic.cleanup());
  }

  discoverCharacteristics() {
    return new Promise((resolve) => {
      resolve(this.characteristics);
    });
  }
}

class MockCharacteristic extends EventEmitter {
  constructor(uuid, properties = []) {
    super();
    this.uuid = uuid;
    this.properties = properties;
    this.value = null;
    this.subscribers = new Set();
  }

  cleanup() {
    this.removeAllListeners();
    this.subscribers.clear();
  }

  read() {
    return new Promise((resolve) => {
      resolve(this.value);
    });
  }

  write(data) {
    return new Promise((resolve) => {
      this.value = data;
      resolve();
    });
  }

  subscribe() {
    return new Promise((resolve) => {
      this.subscribers.add('default');
      resolve();
    });
  }

  unsubscribe() {
    return new Promise((resolve) => {
      this.subscribers.delete('default');
      resolve();
    });
  }

  notify(value) {
    this.emit('data', value);
  }
}

module.exports = {
  MockDevice,
  MockService,
  MockCharacteristic
}; 