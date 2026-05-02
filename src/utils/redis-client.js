'use strict'

/**
 * Tiny Redis-over-HTTP client.
 *
 * The protocol we speak is the one Upstash exposes
 * (https://upstash.com/docs/redis/features/restapi). Vercel KV is
 * Upstash-backed and 100% compatible. Other "Redis" providers that
 * speak RESP-over-TCP are NOT compatible — those need a redis:// URL
 * + ioredis client (out of scope for this serverless-friendly path).
 *
 * Connection config is resolved in this priority order so the operator
 * never has to manually rename Vercel's auto-injected vars:
 *   1. REDIS_URL + REDIS_TOKEN            — generic, recommended
 *   2. KV_REST_API_URL + KV_REST_API_TOKEN — Vercel KV (auto-injected
 *      when the Vercel KV / Upstash integration is attached)
 *   3. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN — Upstash
 *      console "REST API" tab values
 *
 * The client is a no-op when no source is configured — callers should
 * guard via config.dataSaveMode === 'redis' before invoking it.
 */

const axios = require('axios')
const { logger } = require('./logger')

function getConfig() {
  const url =
    process.env.REDIS_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ''
  const token =
    process.env.REDIS_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ''
  const baseUrl = url ? String(url).replace(/\/+$/, '') : ''
  return { baseUrl, token, ok: !!(baseUrl && token) }
}

function isConfigured() {
  return getConfig().ok
}

async function _post(path, body) {
  const { baseUrl, token, ok } = getConfig()
  if (!ok) throw new Error('Redis not configured (set REDIS_URL + REDIS_TOKEN, or KV_REST_API_*, or UPSTASH_REDIS_REST_*)')
  const res = await axios.post(`${baseUrl}${path}`, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 10000,
  })
  return res.data
}

async function _get(path) {
  const { baseUrl, token, ok } = getConfig()
  if (!ok) throw new Error('Redis not configured (set REDIS_URL + REDIS_TOKEN, or KV_REST_API_*, or UPSTASH_REDIS_REST_*)')
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
