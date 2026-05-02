'use strict'

/**
 * Tiny Upstash-Redis-REST client.
 *
 * Upstash exposes Redis over HTTPS (https://upstash.com/docs/redis/features/restapi)
 * which fits Vercel / Netlify / Cloudflare Workers serverless lifecycles
 * better than a TCP-based redis client — no connection pool to drag
 * across cold starts, no socket auth handshake on every invocation.
 *
 * We support a value-as-JSON shape (one big blob per key) which is
 * sufficient for our < 5 MB use case (accounts + proxy state). For
 * higher-volume keys you'd want HSET-shaped operations; not needed here.
 *
 * Configure via:
 *   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN=AXxxxxx
 *
 * The client is a no-op when those env vars are missing — callers should
 * guard via config.dataSaveMode === 'redis' before invoking it.
 */

const axios = require('axios')
const { logger } = require('./logger')

const URL_ENV = 'UPSTASH_REDIS_REST_URL'
const TOKEN_ENV = 'UPSTASH_REDIS_REST_TOKEN'

function getConfig() {
  const baseUrl = process.env[URL_ENV] && String(process.env[URL_ENV]).replace(/\/+$/, '')
  const token = process.env[TOKEN_ENV]
  return { baseUrl, token, ok: !!(baseUrl && token) }
}

function isConfigured() {
  return getConfig().ok
}

async function _post(path, body) {
  const { baseUrl, token, ok } = getConfig()
  if (!ok) throw new Error(`Upstash Redis not configured (${URL_ENV} / ${TOKEN_ENV} missing)`)
  const res = await axios.post(`${baseUrl}${path}`, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 10000,
  })
  return res.data
}

async function _get(path) {
  const { baseUrl, token, ok } = getConfig()
  if (!ok) throw new Error(`Upstash Redis not configured (${URL_ENV} / ${TOKEN_ENV} missing)`)
  const res = await axios.get(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  })
  return res.data
}

/**
 * Get a JSON value by key. Returns null when the key is absent or the
 * stored value is empty / unparseable.
 */
async function getJSON(key) {
  try {
    const data = await _get(`/get/${encodeURIComponent(key)}`)
    const raw = data && data.result
    if (raw === null || raw === undefined || raw === '') return null
    if (typeof raw === 'object') return raw
    return JSON.parse(raw)
  } catch (err) {
    logger.error(`Redis GET ${key} failed: ${err.message}`, 'REDIS')
    return null
  }
}

/**
 * Set a JSON value at key. Returns true on success.
 */
async function setJSON(key, value) {
  try {
    // Upstash supports POSTing the body to /set/<key>; encoding the value
    // in the URL is fragile for large blobs. POST body is the documented
    // path for arbitrary content.
    await _post(`/set/${encodeURIComponent(key)}`, JSON.stringify(value))
    return true
  } catch (err) {
    logger.error(`Redis SET ${key} failed: ${err.message}`, 'REDIS')
    return false
  }
}

async function del(key) {
  try {
    await _post(`/del/${encodeURIComponent(key)}`, '')
    return true
  } catch (err) {
    logger.error(`Redis DEL ${key} failed: ${err.message}`, 'REDIS')
    return false
  }
}

module.exports = {
  isConfigured,
  getJSON,
  setJSON,
  del,
}
