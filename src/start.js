const cluster = require('cluster')
const os = require('os')

// Load environment variables
require('dotenv').config()

const { logger } = require('./utils/logger')

// Get CPU core count
const cpuCores = os.cpus().length

// Get config from env
const PM2_INSTANCES = process.env.PM2_INSTANCES || '1'
const SERVICE_PORT = process.env.SERVICE_PORT || process.env.PORT || 3000

// Parse instance count
let instances
if (PM2_INSTANCES === 'max') {
  instances = cpuCores
} else if (!isNaN(PM2_INSTANCES)) {
  instances = parseInt(PM2_INSTANCES)
} else {
  instances = 1
}

// Limit to CPU core count
if (instances > cpuCores) {
  logger.warn(`Configured instances (${instances}) exceeds CPU cores (${cpuCores}), adjusting to ${cpuCores}`, 'AUTO')
  instances = cpuCores
}

logger.info('Qwen2API starting...', 'AUTO')
logger.info(`CPU cores: ${cpuCores}`, 'AUTO')
logger.info(`Configured instances: ${PM2_INSTANCES}`, 'AUTO')
logger.info(`Actual instances: ${instances}`, 'AUTO')
logger.info(`Service port: ${SERVICE_PORT}`, 'AUTO')

// Smart startup
if (instances === 1) {
  logger.info('Using single-process mode', 'AUTO')

  const config = require('./config/index.js')
  const app = require('./server.js')

  if (config.listenAddress) {
    app.listen(config.listenPort, config.listenAddress, () => {
      logger.server(`Server started on ${config.listenAddress}:${config.listenPort}`, 'SERVER')
    })
  } else {
    app.listen(config.listenPort, () => {
      logger.server(`Server started on port ${config.listenPort}`, 'SERVER')
    })
  }
} else {
  if (cluster.isMaster) {
    logger.info(`Using cluster mode (${instances} workers)`, 'AUTO')

    for (let i = 0; i < instances; i++) {
      const worker = cluster.fork()
      logger.info(`Worker ${i + 1}/${instances} started - PID: ${worker.process.pid}`, 'CLUSTER')
    }

    cluster.on('exit', (worker, code, signal) => {
      logger.error(`Worker ${worker.process.pid} exited - code: ${code}, signal: ${signal}`, 'CLUSTER')

      if (!worker.exitedAfterDisconnect) {
        logger.info('Restarting worker...', 'CLUSTER')
        cluster.fork()
      }
    })

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, gracefully shutting down...', 'CLUSTER')
      cluster.disconnect(() => process.exit(0))
    })

    process.on('SIGINT', () => {
      logger.info('Received SIGINT, gracefully shutting down...', 'CLUSTER')
      cluster.disconnect(() => process.exit(0))
    })
  } else {
    logger.info(`Worker started - PID: ${process.pid}`, 'WORKER')
    const config = require('./config/index.js')
    const app = require('./server.js')

    app.listen(config.listenPort, () => {
      logger.server(`Worker listening on port ${config.listenPort}`, 'SERVER')
    })

    process.on('SIGTERM', () => process.exit(0))
    process.on('SIGINT', () => process.exit(0))
  }
}
