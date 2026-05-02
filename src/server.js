const express = require('express')
const bodyParser = require('body-parser')
const config = require('./config/index.js')
const cors = require('cors')
const { logger } = require('./utils/logger')
const { initSsxmodManager } = require('./utils/ssxmod-manager')
// Single source of truth for the version string. Bumping this in the
// root package.json automatically (a) triggers the release.yml workflow
// because it watches paths: package.json, and (b) gets baked into the
// frontend bundle by Vite's define hook in webui/vite.config.js.
const pkg = require('../package.json')

const modelsRouter = require('./routes/models.js')
const chatRouter = require('./routes/chat.js')
const verifyRouter = require('./routes/verify.js')
const accountsRouter = require('./routes/accounts.js')
const vercelRouter = require('./routes/vercel.js')
const anthropicRouter = require('./routes/anthropic.js')
const geminiRouter = require('./routes/gemini.js')

const app = express()

// Initialize SSXMOD Cookie manager
initSsxmodManager()

app.use(bodyParser.json({ limit: '128mb' }))
app.use(bodyParser.urlencoded({ limit: '128mb', extended: true }))
app.use(cors())

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'qwen-proxy',
    version: pkg.version,
    isVercel: config.isServerless
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// API routes
app.use(anthropicRouter)
app.use(geminiRouter)
app.use(modelsRouter)
app.use(chatRouter)
app.use(verifyRouter)
app.use('/api', accountsRouter)
app.use('/api', vercelRouter)

// Serve frontend static files in production
const path = require('path')
const frontendDist = path.join(__dirname, '..', 'webui', 'dist')
const fs = require('fs')
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/v1/') || req.path.startsWith('/v1beta/') || req.path.startsWith('/api/') || req.path.startsWith('/anthropic/') || req.path === '/health' || req.path === '/verify') {
      return next()
    }
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler (must be after all routes)
app.use((err, req, res, next) => {
  logger.error('Internal server error', 'SERVER', '', err)
  res.status(500).json({ error: 'Internal server error' })
})

// Only listen when not imported (i.e., not in Vercel serverless mode)
if (require.main === module) {
  const serverInfo = {
    address: config.listenAddress || '0.0.0.0',
    port: config.listenPort
  }

  if (config.listenAddress) {
    app.listen(config.listenPort, config.listenAddress, () => {
      logger.server(`Server started on ${serverInfo.address}:${serverInfo.port}`, 'SERVER')
    })
  } else {
    app.listen(config.listenPort, () => {
      logger.server(`Server started on port ${serverInfo.port}`, 'SERVER')
    })
  }
}

module.exports = app
