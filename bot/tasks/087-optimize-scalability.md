# Task 087: Optimize for Scalability and Multi-Server Support

## 1. Task & Context
**Task:** Implement scalable architecture with multi-server support, load balancing, and horizontal scaling capabilities
**Scope:** Server architecture, load balancing, database scaling, microservices design
**Branch:** slow-mode
**Priority:** MEDIUM - Future growth and performance

## 2. Quick Plan
**Approach:** Design scalable server architecture, implement load balancing, add database sharding, create microservices structure
**Complexity:** 4-Very High (distributed systems, infrastructure)
**Uncertainty:** 3-High (production deployment, scaling challenges)

## 3. Implementation

### Current Issues Found:
- Single server architecture limitation
- No load balancing capabilities
- Database scaling constraints
- Monolithic server structure
- No horizontal scaling support

### Solution Approach:
1. Design multi-server architecture
2. Implement load balancing
3. Add database sharding and replication
4. Create microservices structure
5. Add monitoring and auto-scaling

### Implementation Steps:

**Step 1: Design Multi-Server Architecture**
```javascript
// server/config/server-config.js
export const SERVER_CONFIG = {
  // Server clustering
  cluster: {
    enabled: process.env.CLUSTER_ENABLED === 'true',
    workerCount: process.env.WORKER_COUNT || 'auto',
    stickySessions: true
  },

  // Load balancing
  loadBalancer: {
    algorithm: 'least-connections', // round-robin, least-connections, ip-hash
    healthCheck: {
      enabled: true,
      interval: 30000, // 30 seconds
      timeout: 5000,   // 5 seconds
      path: '/health'
    }
  },

  // Database sharding
  database: {
    sharding: {
      enabled: process.env.DB_SHARDING_ENABLED === 'true',
      shardCount: parseInt(process.env.DB_SHARD_COUNT) || 4,
      shardKey: 'userId',
      readReplicas: parseInt(process.env.DB_READ_REPLICAS) || 2
    }
  },

  // Caching
  cache: {
    redis: {
      enabled: process.env.REDIS_ENABLED === 'true',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      ttl: 3600 // 1 hour
    },
    local: {
      maxSize: 1000,
      ttl: 300 // 5 minutes
    }
  },

  // Message queuing
  queue: {
    enabled: process.env.QUEUE_ENABLED === 'true',
    provider: process.env.QUEUE_PROVIDER || 'redis', // redis, rabbitmq, sqs
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY) || 10
  }
};
```

**Step 2: Implement Server Clustering**
```javascript
// server/cluster/cluster-manager.js
import cluster from 'cluster';
import os from 'os';
import { SERVER_CONFIG } from '../config/server-config.js';

export class ClusterManager {
  constructor() {
    this.workers = new Map();
    this.isMaster = cluster.isMaster;
  }

  initialize() {
    if (!SERVER_CONFIG.cluster.enabled) {
      this.startSingleServer();
      return;
    }

    if (this.isMaster) {
      this.startMaster();
    } else {
      this.startWorker();
    }
  }

  startMaster() {
    console.log(`Master ${process.pid} is running`);

    const workerCount = SERVER_CONFIG.cluster.workerCount === 'auto'
      ? os.cpus().length
      : parseInt(SERVER_CONFIG.cluster.workerCount);

    // Fork workers
    for (let i = 0; i < workerCount; i++) {
      this.forkWorker();
    }

    // Handle worker events
    cluster.on('exit', (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died with code: ${code}, signal: ${signal}`);
      this.workers.delete(worker.id);
      this.forkWorker(); // Replace dead worker
    });

    cluster.on('online', (worker) => {
      console.log(`Worker ${worker.process.pid} is online`);
      this.workers.set(worker.id, worker);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('Master received SIGTERM, shutting down gracefully...');
      this.shutdownWorkers();
    });
  }

  forkWorker() {
    const worker = cluster.fork();
    this.workers.set(worker.id, worker);

    // Handle worker messages
    worker.on('message', (message) => {
      this.handleWorkerMessage(worker, message);
    });
  }

  handleWorkerMessage(worker, message) {
    switch (message.type) {
      case 'health_check':
        // Respond to health check
        worker.send({ type: 'health_response', status: 'healthy' });
        break;
      case 'metrics':
        // Aggregate metrics from workers
        this.aggregateMetrics(message.data);
        break;
    }
  }

  shutdownWorkers() {
    for (const worker of this.workers.values()) {
      worker.kill('SIGTERM');
    }

    setTimeout(() => {
      console.log('Forcing shutdown...');
      process.exit(0);
    }, 10000);
  }

  startWorker() {
    console.log(`Worker ${process.pid} started`);

    // Start the actual server
    import('../server.js').then(({ startServer }) => {
      startServer();
    });

    // Send periodic health checks to master
    setInterval(() => {
      if (process.send) {
        process.send({
          type: 'health_check',
          pid: process.pid,
          memory: process.memoryUsage(),
          uptime: process.uptime()
        });
      }
    }, 30000);

    // Handle worker shutdown
    process.on('SIGTERM', () => {
      console.log(`Worker ${process.pid} received SIGTERM, shutting down...`);
      process.exit(0);
    });
  }

  startSingleServer() {
    import('../server.js').then(({ startServer }) => {
      startServer();
    });
  }

  aggregateMetrics(metrics) {
    // Aggregate metrics from all workers
    // This would be used for monitoring and scaling decisions
    console.log('Aggregated metrics:', metrics);
  }
}
```

**Step 3: Implement Load Balancing**
```javascript
// server/load-balancer/load-balancer.js
import http from 'http';
import httpProxy from 'http-proxy';
import { SERVER_CONFIG } from '../config/server-config.js';

export class LoadBalancer {
  constructor() {
    this.proxy = httpProxy.createProxyServer();
    this.servers = [];
    this.currentIndex = 0;
    this.serverHealth = new Map();
  }

  initialize() {
    this.setupServers();
    this.startHealthChecks();
    this.createLoadBalancer();
  }

  setupServers() {
    // Get server list from environment or configuration
    const serverList = process.env.BACKEND_SERVERS?.split(',') || ['http://localhost:3001'];

    this.servers = serverList.map(url => ({
      url,
      healthy: true,
      connections: 0
    }));
  }

  createLoadBalancer() {
    const server = http.createServer((req, res) => {
      const targetServer = this.selectServer();

      if (!targetServer) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Service Unavailable');
        return;
      }

      // Increment connection count
      targetServer.connections++;

      this.proxy.web(req, res, {
        target: targetServer.url,
        changeOrigin: true
      }, (err) => {
        console.error('Proxy error:', err);
        targetServer.connections--;
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      });

      // Decrement connection count when response ends
      res.on('finish', () => {
        targetServer.connections--;
      });
    });

    server.listen(process.env.LB_PORT || 3000, () => {
      console.log(`Load balancer listening on port ${process.env.LB_PORT || 3000}`);
    });
  }

  selectServer() {
    const algorithm = SERVER_CONFIG.loadBalancer.algorithm;

    switch (algorithm) {
      case 'round-robin':
        return this.selectRoundRobin();
      case 'least-connections':
        return this.selectLeastConnections();
      case 'ip-hash':
        return this.selectIPHash();
      default:
        return this.selectRoundRobin();
    }
  }

  selectRoundRobin() {
    const healthyServers = this.servers.filter(server => server.healthy);

    if (healthyServers.length === 0) return null;

    const server = healthyServers[this.currentIndex % healthyServers.length];
    this.currentIndex = (this.currentIndex + 1) % healthyServers.length;

    return server;
  }

  selectLeastConnections() {
    const healthyServers = this.servers.filter(server => server.healthy);

    if (healthyServers.length === 0) return null;

    return healthyServers.reduce((min, server) =>
      server.connections < min.connections ? server : min
    );
  }

  selectIPHash() {
    // IP-based routing for session stickiness
    // This would require getting client IP from request
    return this.selectRoundRobin(); // Simplified
  }

  startHealthChecks() {
    setInterval(() => {
      this.performHealthChecks();
    }, SERVER_CONFIG.loadBalancer.healthCheck.interval);
  }

  async performHealthChecks() {
    for (const server of this.servers) {
      try {
        const response = await fetch(`${server.url}${SERVER_CONFIG.loadBalancer.healthCheck.path}`, {
          timeout: SERVER_CONFIG.loadBalancer.healthCheck.timeout
        });

        server.healthy = response.ok;
      } catch (error) {
        server.healthy = false;
        console.warn(`Health check failed for ${server.url}:`, error.message);
      }
    }

    this.logHealthStatus();
  }

  logHealthStatus() {
    const healthy = this.servers.filter(s => s.healthy).length;
    const total = this.servers.length;
    console.log(`Server health: ${healthy}/${total} servers healthy`);
  }
}
```

**Step 4: Implement Database Sharding**
```javascript
// server/database/shard-manager.js
import { SERVER_CONFIG } from '../config/server-config.js';

export class ShardManager {
  constructor() {
    this.shards = [];
    this.shardKey = SERVER_CONFIG.database.sharding.shardKey;
  }

  initialize() {
    if (!SERVER_CONFIG.database.sharding.enabled) {
      this.setupSingleDatabase();
      return;
    }

    this.setupShards();
    this.setupReadReplicas();
  }

  setupShards() {
    const shardCount = SERVER_CONFIG.database.sharding.shardCount;

    for (let i = 0; i < shardCount; i++) {
      this.shards.push({
        id: i,
        connection: this.createShardConnection(i),
        range: this.calculateShardRange(i, shardCount)
      });
    }
  }

  createShardConnection(shardId) {
    // Create database connection for this shard
    const connectionString = process.env[`DB_SHARD_${shardId}_URL`] ||
                            `postgresql://user:pass@localhost:5432/game_shard_${shardId}`;

    // Return database connection (implementation depends on your DB library)
    return {
      id: shardId,
      url: connectionString,
      pool: this.createConnectionPool(connectionString)
    };
  }

  calculateShardRange(shardId, totalShards) {
    // Simple hash-based sharding
    const rangeSize = Math.floor(0xFFFFFFFF / totalShards);
    return {
      min: shardId * rangeSize,
      max: (shardId + 1) * rangeSize - 1
    };
  }

  getShardForKey(key) {
    if (!SERVER_CONFIG.database.sharding.enabled) {
      return this.shards[0];
    }

    // Hash the key to determine shard
    const hash = this.hashKey(key);
    const shardIndex = hash % this.shards.length;

    return this.shards[shardIndex];
  }

  hashKey(key) {
    // Simple hash function for sharding
    let hash = 0;
    const str = key.toString();

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash);
  }

  async executeQuery(query, params = [], key = null) {
    const shard = key ? this.getShardForKey(key) : this.shards[0];

    try {
      return await shard.connection.pool.query(query, params);
    } catch (error) {
      console.error(`Query failed on shard ${shard.id}:`, error);
      throw error;
    }
  }

  async executeReadQuery(query, params = [], key = null) {
    if (!SERVER_CONFIG.database.sharding.enabled) {
      return this.executeQuery(query, params, key);
    }

    // Use read replica if available
    const shard = this.getShardForKey(key);
    const replica = this.getReadReplica(shard);

    if (replica) {
      try {
        return await replica.pool.query(query, params);
      } catch (error) {
        console.warn('Read replica query failed, falling back to primary:', error);
      }
    }

    // Fallback to primary shard
    return this.executeQuery(query, params, key);
  }

  setupReadReplicas() {
    const replicaCount = SERVER_CONFIG.database.sharding.readReplicas;

    this.shards.forEach(shard => {
      shard.replicas = [];

      for (let i = 0; i < replicaCount; i++) {
        const replicaUrl = process.env[`DB_SHARD_${shard.id}_REPLICA_${i}_URL`];
        if (replicaUrl) {
          shard.replicas.push({
            id: i,
            url: replicaUrl,
            pool: this.createConnectionPool(replicaUrl)
          });
        }
      }
    });
  }

  getReadReplica(shard) {
    if (!shard.replicas || shard.replicas.length === 0) {
      return null;
    }

    // Simple round-robin selection
    const replicaIndex = Math.floor(Math.random() * shard.replicas.length);
    return shard.replicas[replicaIndex];
  }

  setupSingleDatabase() {
    // Fallback for single database setup
    this.shards = [{
      id: 0,
      connection: this.createShardConnection(0),
      replicas: []
    }];
  }

  async migrateData() {
    // Data migration logic for existing data
    // This would be run when enabling sharding on existing database
    console.log('Starting data migration for sharding...');

    // Implementation would depend on your specific migration needs
    // This is a simplified version
  }

  getShardStats() {
    return this.shards.map(shard => ({
      id: shard.id,
      connectionCount: shard.connection.pool.totalCount,
      idleCount: shard.connection.pool.idleCount,
      waitingCount: shard.connection.pool.waitingCount,
      replicaCount: shard.replicas?.length || 0
    }));
  }
}
```

**Step 5: Implement Caching Layer**
```javascript
// server/cache/cache-manager.js
import Redis from 'ioredis';
import { SERVER_CONFIG } from '../config/server-config.js';

export class CacheManager {
  constructor() {
    this.redis = null;
    this.localCache = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (SERVER_CONFIG.cache.redis.enabled) {
      await this.initializeRedis();
    }

    this.initialized = true;
    this.startCleanupInterval();
  }

  async initializeRedis() {
    this.redis = new Redis({
      host: SERVER_CONFIG.cache.redis.host,
      port: SERVER_CONFIG.cache.redis.port,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3
    });

    this.redis.on('connect', () => {
      console.log('Redis connected');
    });

    this.redis.on('error', (error) => {
      console.error('Redis error:', error);
    });
  }

  async get(key) {
    if (!this.initialized) return null;

    // Try Redis first
    if (this.redis) {
      try {
        const value = await this.redis.get(key);
        if (value) {
          return JSON.parse(value);
        }
      } catch (error) {
        console.warn('Redis get failed:', error);
      }
    }

    // Fallback to local cache
    const localValue = this.localCache.get(key);
    if (localValue && !this.isExpired(localValue)) {
      return localValue.data;
    }

    return null;
  }

  async set(key, value, ttl = null) {
    if (!this.initialized) return;

    const ttlValue = ttl || SERVER_CONFIG.cache.redis.ttl;
    const cacheData = {
      data: value,
      timestamp: Date.now(),
      ttl: ttlValue
    };

    // Set in Redis
    if (this.redis) {
      try {
        await this.redis.setex(key, ttlValue, JSON.stringify(cacheData));
      } catch (error) {
        console.warn('Redis set failed:', error);
      }
    }

    // Set in local cache
    this.localCache.set(key, cacheData);

    // Maintain local cache size
    if (this.localCache.size > SERVER_CONFIG.cache.local.maxSize) {
      this.evictOldest();
    }
  }

  async delete(key) {
    if (!this.initialized) return;

    // Delete from Redis
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (error) {
        console.warn('Redis delete failed:', error);
      }
    }

    // Delete from local cache
    this.localCache.delete(key);
  }

  async clear() {
    if (!this.initialized) return;

    // Clear Redis
    if (this.redis) {
      try {
        await this.redis.flushall();
      } catch (error) {
        console.warn('Redis clear failed:', error);
      }
    }

    // Clear local cache
    this.localCache.clear();
  }

  isExpired(cacheData) {
    const age = Date.now() - cacheData.timestamp;
    return age > (cacheData.ttl * 1000);
  }

  evictOldest() {
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, value] of this.localCache) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.localCache.delete(oldestKey);
    }
  }

  startCleanupInterval() {
    setInterval(() => {
      this.cleanupExpired();
    }, 60000); // Clean up every minute
  }

  cleanupExpired() {
    const now = Date.now();
    const toDelete = [];

    for (const [key, value] of this.localCache) {
      if (this.isExpired(value)) {
        toDelete.push(key);
      }
    }

    toDelete.forEach(key => this.localCache.delete(key));

    if (toDelete.length > 0) {
      console.log(`Cleaned up ${toDelete.length} expired cache entries`);
    }
  }

  getStats() {
    return {
      redis: {
        connected: this.redis?.status === 'ready',
        ping: this.redis ? await this.redis.ping() : null
      },
      local: {
        size: this.localCache.size,
        maxSize: SERVER_CONFIG.cache.local.maxSize
      }
    };
  }

  // Cache decorators for easy usage
  static cache(ttl = null) {
    return function(target, propertyKey, descriptor) {
      const originalMethod = descriptor.value;
      const cacheKeyPrefix = `${target.constructor.name}.${propertyKey}`;

      descriptor.value = async function(...args) {
        const cacheKey = `${cacheKeyPrefix}:${JSON.stringify(args)}`;
        const cacheManager = this.cacheManager;

        if (!cacheManager) {
          return await originalMethod.apply(this, args);
        }

        let result = await cacheManager.get(cacheKey);
        if (result !== null) {
          return result;
        }

        result = await originalMethod.apply(this, args);
        await cacheManager.set(cacheKey, result, ttl);

        return result;
      };

      return descriptor;
    };
  }
}
```

**Step 6: Add Monitoring and Auto-Scaling**
```javascript
// server/monitoring/monitoring-system.js
import { SERVER_CONFIG } from '../config/server-config.js';

export class MonitoringSystem {
  constructor() {
    this.metrics = {
      cpu: [],
      memory: [],
      requests: [],
      responseTime: [],
      errorRate: []
    };
    this.alerts = [];
    this.thresholds = {
      cpu: 80, // 80% CPU usage
      memory: 85, // 85% memory usage
      responseTime: 1000, // 1 second average response time
      errorRate: 5 // 5% error rate
    };
  }

  initialize() {
    this.startMetricsCollection();
    this.setupAlerting();
    this.setupAutoScaling();
  }

  startMetricsCollection() {
    setInterval(() => {
      this.collectSystemMetrics();
      this.collectApplicationMetrics();
      this.checkThresholds();
    }, 60000); // Every minute
  }

  collectSystemMetrics() {
    // CPU usage
    const cpuUsage = process.cpuUsage();
    this.metrics.cpu.push({
      timestamp: Date.now(),
      usage: (cpuUsage.user + cpuUsage.system) / 1000000 // Convert to seconds
    });

    // Memory usage
    const memUsage = process.memoryUsage();
    this.metrics.memory.push({
      timestamp: Date.now(),
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    });

    // Keep only last 60 minutes of data
    this.trimMetrics();
  }

  collectApplicationMetrics() {
    // These would be populated by your application
    // For example, request count, response times, error counts
    // This is a simplified version
  }

  checkThresholds() {
    const latestCpu = this.getLatestMetric('cpu');
    const latestMemory = this.getLatestMetric('memory');

    if (latestCpu && latestCpu.usage > this.thresholds.cpu) {
      this.triggerAlert('high_cpu', `CPU usage is ${latestCpu.usage.toFixed(1)}%`);
    }

    if (latestMemory && (latestMemory.heapUsed / latestMemory.heapTotal) * 100 > this.thresholds.memory) {
      this.triggerAlert('high_memory', `Memory usage is ${(latestMemory.heapUsed / latestMemory.heapTotal * 100).toFixed(1)}%`);
    }
  }

  triggerAlert(type, message) {
    const alert = {
      type,
      message,
      timestamp: Date.now(),
      resolved: false
    };

    this.alerts.push(alert);
    console.warn(`ALERT: ${message}`);

    // Send alert to monitoring service (e.g., PagerDuty, Slack)
    this.sendAlert(alert);
  }

  async sendAlert(alert) {
    // Implementation would depend on your alerting service
    // This could send to Slack, email, PagerDuty, etc.
    console.log('Sending alert:', alert);
  }

  setupAutoScaling() {
    // Simple auto-scaling logic
    setInterval(() => {
      this.evaluateScaling();
    }, 300000); // Every 5 minutes
  }

  evaluateScaling() {
    const avgCpu = this.getAverageMetric('cpu', 5); // Last 5 minutes
    const avgMemory = this.getAverageMetric('memory', 5);

    if (avgCpu > 70 || avgMemory > 80) {
      console.log('Scaling up: High resource usage detected');
      this.scaleUp();
    } else if (avgCpu < 30 && avgMemory < 50) {
      console.log('Scaling down: Low resource usage detected');
      this.scaleDown();
    }
  }

  scaleUp() {
    // Implementation would depend on your deployment setup
    // This could be Kubernetes, Docker Swarm, AWS ECS, etc.
    console.log('Initiating scale up...');
  }

  scaleDown() {
    console.log('Initiating scale down...');
  }

  getLatestMetric(type) {
    const metricArray = this.metrics[type];
    return metricArray.length > 0 ? metricArray[metricArray.length - 1] : null;
  }

  getAverageMetric(type, minutes) {
    const metricArray = this.metrics[type];
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const recentMetrics = metricArray.filter(m => m.timestamp > cutoff);

    if (recentMetrics.length === 0) return 0;

    switch (type) {
      case 'cpu':
        return recentMetrics.reduce((sum, m) => sum + m.usage, 0) / recentMetrics.length;
      case 'memory':
        const avgMemory = recentMetrics.reduce((sum, m) => sum + (m.heapUsed / m.heapTotal), 0) / recentMetrics.length;
        return avgMemory * 100; // Convert to percentage
      default:
        return 0;
    }
  }

  trimMetrics() {
    const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour ago

    Object.keys(this.metrics).forEach(key => {
      this.metrics[key] = this.metrics[key].filter(m => m.timestamp > cutoff);
    });
  }

  getMetricsSummary() {
    return {
      cpu: {
        current: this.getLatestMetric('cpu')?.usage || 0,
        average: this.getAverageMetric('cpu', 5)
      },
      memory: {
        current: this.getLatestMetric('memory'),
        average: this.getAverageMetric('memory', 5)
      },
      alerts: this.alerts.filter(a => !a.resolved).length,
      uptime: process.uptime()
    };
  }
}
```

## 4. Check & Commit

**Files to Update:**
- server/config/server-config.js (new)
- server/cluster/cluster-manager.js (new)
- server/load-balancer/load-balancer.js (new)
- server/database/shard-manager.js (new)
- server/cache/cache-manager.js (new)
- server/monitoring/monitoring-system.js (new)
- server.js (update to use new architecture)

**Expected Impact:**
- Support for multiple server instances
- Improved performance through load balancing
- Database scalability with sharding
- Better caching and reduced database load
- Automatic scaling based on demand
- Improved reliability and uptime

**Testing:**
- Test clustering functionality
- Verify load balancing works correctly
- Test database sharding with sample data
- Validate caching behavior
- Check monitoring and alerting
- Test auto-scaling triggers

**Commit Message:** feat: Implement scalable multi-server architecture with load balancing, database sharding, and monitoring

**Status:** Ready for implementation