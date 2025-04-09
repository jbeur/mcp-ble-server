const WebSocket = require('ws');
const WebSocketServer = require('../../src/mcp/server/WebSocketServer');
const { logger } = require('../../src/utils/logger');

const TEST_PORT = 8083;
const WAIT_TIME = 100; // ms

describe('WebSocket Server Load Tests', () => {
  let server;

  beforeAll(async () => {
    server = new WebSocketServer({
      port: TEST_PORT,
      maxConnections: 100,
      maxQueueSize: 1000,
      batchSize: 50
    });
    await server.start();
  });

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  afterEach(async () => {
    // Clean up any remaining connections
    if (server && server.wss) {
      server.wss.clients.forEach(client => {
        client.close();
      });
    }
    // Wait for connections to close
    await new Promise(resolve => setTimeout(resolve, WAIT_TIME));
  });

  describe('Connection Load', () => {
    it('should handle multiple concurrent connections', async () => {
      const startTime = Date.now();
      const numConnections = 50;
      const connections = [];

      for (let i = 0; i < numConnections; i++) {
        connections.push(
          new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
            ws.on('open', () => resolve(ws));
            ws.on('error', reject);
          })
        );
      }

      const connectedClients = await Promise.all(connections);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTime = totalTime / numConnections;

      logger.info('WebSocket Connection Load Test:', {
        numConnections,
        totalTime,
        avgTimePerConnection: avgTime
      });

      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
      expect(server.connectionCount).toBe(numConnections);

      // Clean up connections
      connectedClients.forEach(ws => ws.close());
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      const numCycles = 20;
      const cycleTimes = [];

      for (let i = 0; i < numCycles; i++) {
        const cycleStart = Date.now();
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        await new Promise((resolve) => ws.on('open', resolve));
        ws.close();
        await new Promise((resolve) => ws.on('close', resolve));
        const cycleEnd = Date.now();
        cycleTimes.push(cycleEnd - cycleStart);
        // Wait a bit between cycles to prevent overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const avgCycleTime = cycleTimes.reduce((a, b) => a + b, 0) / numCycles;
      const maxCycleTime = Math.max(...cycleTimes);

      logger.info('WebSocket Connect/Disconnect Cycle Test:', {
        numCycles,
        avgCycleTime,
        maxCycleTime,
        cycleTimes
      });

      expect(avgCycleTime).toBeLessThan(500); // Average cycle should be under 500ms
      expect(server.connectionCount).toBe(0); // All connections should be closed
    });

    it('should handle connection limit gracefully', async () => {
      const maxConnections = server.maxConnections;
      const connections = [];
      const results = { successful: 0, rejected: 0 };

      // Try to establish more connections than the limit
      for (let i = 0; i < maxConnections + 10; i++) {
        try {
          const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
          await new Promise((resolve, reject) => {
            ws.on('open', () => {
              results.successful++;
              resolve(ws);
            });
            ws.on('error', (error) => {
              if (error.message.includes('503')) {
                results.rejected++;
                resolve(null);
              } else {
                reject(error);
              }
            });
            // Add timeout to prevent hanging
            setTimeout(() => resolve(null), 1000);
          });
        } catch (error) {
          // Ignore connection errors as they're expected
          if (error.message.includes('503')) {
            results.rejected++;
          }
        }
      }

      expect(results.successful).toBeLessThanOrEqual(maxConnections);
      expect(results.rejected).toBeGreaterThan(0);
      expect(server.connectionCount).toBeLessThanOrEqual(maxConnections);

      // Clean up successful connections
      server.wss.clients.forEach(client => client.close());
    }, 15000); // Increase timeout for this test
  });

  describe('Message Load', () => {
    it('should handle multiple concurrent message sends', async () => {
      const numClients = 5;
      const messagesPerClient = 100;
      const startTime = Date.now();
      const clients = [];
      const messagePromises = [];

      // Connect clients
      for (let i = 0; i < numClients; i++) {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        const connected = new Promise((resolve) => ws.on('open', () => resolve(ws)));
        clients.push(connected);
      }

      const connectedClients = await Promise.all(clients);

      // Send messages from all clients
      connectedClients.forEach((ws) => {
        for (let j = 0; j < messagesPerClient; j++) {
          const promise = new Promise((resolve) => {
            ws.send(JSON.stringify({
              type: 'test',
              data: `message_${j}`
            }), resolve);
          });
          messagePromises.push(promise);
        }
      });

      await Promise.all(messagePromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const totalMessages = numClients * messagesPerClient;
      const messagesPerSecond = totalMessages / (totalTime / 1000);

      logger.info('WebSocket Message Load Test:', {
        numClients,
        messagesPerClient,
        totalMessages,
        totalTime,
        messagesPerSecond
      });

      expect(messagesPerSecond).toBeGreaterThan(100); // Should handle at least 100 messages per second

      // Clean up connections
      connectedClients.forEach(ws => ws.close());
    });

    it('should handle message queuing and batch processing', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      await new Promise((resolve) => ws.on('open', resolve));

      const numMessages = 200; // More than maxBatchSize to test queuing
      const messagePromises = [];

      // Send messages rapidly
      for (let i = 0; i < numMessages; i++) {
        const promise = new Promise((resolve) => {
          ws.send(JSON.stringify({
            type: 'test',
            data: `message_${i}`
          }), resolve);
        });
        messagePromises.push(promise);
      }

      await Promise.all(messagePromises);
            
      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify server state
      expect(server.messageQueue.get(Array.from(server.clients.keys())[0])).toBeDefined();
            
      ws.close();
    });

    it('should handle message queue overflow gracefully', async () => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      let overflowErrors = 0;
      let connected = false;

      await new Promise((resolve) => {
        ws.on('open', () => {
          connected = true;
          resolve();
        });
      });

      expect(connected).toBe(true);

      // Set up error message handler
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'error' && message.code === 'QUEUE_FULL') {
            overflowErrors++;
          }
        } catch (error) {
          // Ignore parse errors
        }
      });

      // Send more messages than the queue can handle
      const numMessages = server.maxQueueSize * 2;
      const messagePromises = [];

      // Send messages as fast as possible
      for (let i = 0; i < numMessages; i++) {
        const promise = new Promise((resolve) => {
          ws.send(JSON.stringify({
            type: 'test',
            data: `message_${i}`,
            timestamp: Date.now()
          }), resolve);
        });
        messagePromises.push(promise);

        // Don't wait for promises to resolve
        if (i % 100 === 0) {
          // Small delay every 100 messages to allow error messages to be received
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Wait for all messages to be sent
      await Promise.all(messagePromises);
            
      // Wait for error messages to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(overflowErrors).toBeGreaterThan(0);
            
      ws.close();
    }, 15000); // Increase timeout for this test
  });
}); 