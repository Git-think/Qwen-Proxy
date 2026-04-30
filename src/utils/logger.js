const fs = require('fs')
const path = require('path')

/**
 * Logger
 * Unified log management with level-based output, timestamps, and emoji tags
 */
class Logger {
  constructor(options = {}) {
    this.options = {
      level: options.level || 'INFO',
      enableFileLog: options.enableFileLog || false,
      logDir: options.logDir || path.join(__dirname, '../../logs'),
      logFileName: options.logFileName || 'app.log',
      showTimestamp: options.showTimestamp !== false,
      showLevel: options.showLevel !== false,
      showModule: options.showModule !== false,
      maxFileSize: options.maxFileSize || 10,
      maxFiles: options.maxFiles || 5
    }

    this.levels = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    }

    this.emojis = {
      DEBUG: '🔍',
      INFO: '📝',
      WARN: '⚠️',
      ERROR: '❌',
      SUCCESS: '✅',
      NETWORK: '🌐',
      AUTH: '🔐',
      UPLOAD: '📤',
      TOKEN: '🎫',
      CHAT: '💬',
      MODEL: '🤖',
      SERVER: '🚀',
      PROCESS: '⚡'
    }

    this.colors = {
      DEBUG: '\x1b[36m',
      INFO: '\x1b[32m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      RESET: '\x1b[0m',
      BRIGHT: '\x1b[1m',
      DIM: '\x1b[2m'
    }

    if (this.options.enableFileLog) {
      this.initLogDirectory()
    }
  }

  initLogDirectory() {
    try {
      if (!fs.existsSync(this.options.logDir)) {
        fs.mkdirSync(this.options.logDir, { recursive: true })
      }
    } catch (error) {
      console.error('Failed to create log directory:', error.message)
    }
  }

  shouldLog(level) {
    return this.levels[level] >= this.levels[this.options.level]
  }

  formatTimestamp() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }

  formatMessage(level, message, module = '', emoji = '') {
    const timestamp = this.options.showTimestamp ? this.formatTimestamp() : ''
    const levelStr = this.options.showLevel ? `[${level}]` : ''
    const moduleStr = this.options.showModule && module ? `[${module}]` : ''
    const emojiStr = emoji || this.emojis[level] || ''

    const consoleMessage = [
      this.colors.DIM + timestamp + this.colors.RESET,
      this.colors[level] + levelStr + this.colors.RESET,
      this.colors.BRIGHT + moduleStr + this.colors.RESET,
      emojiStr,
      message
    ].filter(Boolean).join(' ')

    const fileMessage = [
      timestamp,
      levelStr,
      moduleStr,
      emojiStr,
      message
    ].filter(Boolean).join(' ')

    return { consoleMessage, fileMessage }
  }

  writeToFile(message) {
    if (!this.options.enableFileLog) return

    try {
      const logFile = path.join(this.options.logDir, this.options.logFileName)
      const logEntry = `${message}\n`

      this.rotateLogFile(logFile)
      fs.appendFileSync(logFile, logEntry, 'utf8')
    } catch (error) {
      console.error('Failed to write log file:', error.message)
    }
  }

  rotateLogFile(logFile) {
    try {
      if (!fs.existsSync(logFile)) return

      const stats = fs.statSync(logFile)
      const fileSizeMB = stats.size / (1024 * 1024)

      if (fileSizeMB > this.options.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupFile = logFile.replace('.log', `_${timestamp}.log`)
        fs.renameSync(logFile, backupFile)
        this.cleanOldLogFiles()
      }
    } catch (error) {
      console.error('Log file rotation failed:', error.message)
    }
  }

  cleanOldLogFiles() {
    try {
      const files = fs.readdirSync(this.options.logDir)
      const logFiles = files
        .filter(file => file.endsWith('.log') && file !== this.options.logFileName)
        .map(file => ({
          name: file,
          path: path.join(this.options.logDir, file),
          mtime: fs.statSync(path.join(this.options.logDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime)

      if (logFiles.length > this.options.maxFiles) {
        const filesToDelete = logFiles.slice(this.options.maxFiles)
        filesToDelete.forEach(file => {
          fs.unlinkSync(file.path)
        })
      }
    } catch (error) {
      console.error('Failed to clean old log files:', error.message)
    }
  }

  log(level, message, module = '', emoji = '', data = null) {
    if (!this.shouldLog(level)) return

    const { consoleMessage, fileMessage } = this.formatMessage(level, message, module, emoji)

    if (level === 'ERROR') {
      console.error(consoleMessage)
    } else if (level === 'WARN') {
      console.warn(consoleMessage)
    } else {
      console.log(consoleMessage)
    }

    if (data !== null) {
      console.log(data)
    }

    this.writeToFile(fileMessage + (data ? `\n${JSON.stringify(data, null, 2)}` : ''))
  }

  debug(message, module = '', emoji = '', data = null) {
    this.log('DEBUG', message, module, emoji || this.emojis.DEBUG, data)
  }

  info(message, module = '', emoji = '', data = null) {
    this.log('INFO', message, module, emoji || this.emojis.INFO, data)
  }

  warn(message, module = '', emoji = '', data = null) {
    this.log('WARN', message, module, emoji || this.emojis.WARN, data)
  }

  error(message, module = '', emoji = '', data = null) {
    this.log('ERROR', message, module, emoji || this.emojis.ERROR, data)
  }

  success(message, module = '', data = null) {
    this.info(message, module, this.emojis.SUCCESS, data)
  }

  network(message, module = '', data = null) {
    this.info(message, module, this.emojis.NETWORK, data)
  }

  auth(message, module = '', data = null) {
    this.info(message, module, this.emojis.AUTH, data)
  }

  chat(message, module = '', data = null) {
    this.info(message, module, this.emojis.CHAT, data)
  }

  server(message, module = '', data = null) {
    this.info(message, module, this.emojis.SERVER, data)
  }
}

// Create default instance
const defaultLogger = new Logger({
  level: process.env.LOG_LEVEL || 'INFO',
  enableFileLog: process.env.ENABLE_FILE_LOG === 'true',
  showModule: true,
  showTimestamp: true,
  showLevel: true
})

module.exports = {
  Logger,
  logger: defaultLogger
}
