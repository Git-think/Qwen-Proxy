'use strict'

/**
 * Vercel env-var sync helpers.
 *
 * Used by the smart-proxy admin endpoints so when an operator adds /
 * removes a proxy at runtime, the change is also pushed back to the
 * Vercel project's PROXIES env var — so the next Vercel cold start
 * picks up the same set instead of resetting to whatever was last
 * persisted via the dashboard.
 *
 * Strict guards before doing any work:
 *   - VERCEL_TOKEN + VERCEL_PROJECT_ID must both be set
 *   - DATA_SAVE_MODE must NOT be 'redis' — when redis is on, the proxy
 *     pool already lives there and we don't need to roundtrip through
 *     the Vercel API at all (and roundtripping just causes a deploy
 *     amplification with no benefit)
 *
 * On guard failure the helpers return { synced: false, reason: '...' }
 * so the caller can surface this in the API response without raising.
 */

const axios = require('axios')
const config = require('../config/index.js')
const redisClient = require('./redis-client.js')
const { logger } = require('./logger')

const VERCEL_API = 'https://api.vercel.com'
const ENV_KEY = 'PROXIES'
const TARGET = ['production', 'preview', 'development']

function getCfg() {
  return {
    token: process.env.VERCEL_TOKEN,
    projectId: process.env.VERCEL_PROJECT_ID,
    teamId: process.env.VERCEL_TEAM_ID || '',
  }
}

function shouldSync() {
  // Redis already covers persistence — don't trigger Vercel deploys
  // unnecessarily.
  if (config.dataSaveMode === 'redis' && redisClient.isConfigured()) {
    return { ok: false, reason: 'redis_active' }
  }
  const { token, projectId } = getCfg()
  if (!token || !projectId) return { ok: false, reason: 'vercel_not_configured' }
  return { ok: true }
}

function _baseUrl(path) {
  const { teamId } = getCfg()
  const sep = path.includes('?') ? '&' : '?'
  return `${VERCEL_API}${path}${teamId ? `${sep}teamId=${teamId}` : ''}`
}

function _headers() {
  return { Authorization: `Bearer ${getCfg().token}` }
}

/**
 * Find an existing env var by key (returns the env object or null).
 */
async function _findEnv(key) {
  const { projectId } = getCfg()
  const res = await axios.get(_baseUrl(`/v9/projects/${projectId}/env`), { headers: _headers() })
  return (res.data.envs || []).find(e => e.key === key) || null
}

async function _writeEnv(key, value) {
  const { projectId } = getCfg()
  const existing = await _findEnv(key)
  if (existing) {
    await axios.patch(
      _baseUrl(`/v9/projects/${projectId}/env/${existing.id}`),
      { value, target: TARGET, type: existing.type || 'encrypted' },
      { headers: _headers() }
    )
  } else {
    await axios.post(
      _baseUrl(`/v9/projects/${projectId}/env`),
      { key, value, target: TARGET, type: 'encrypted' },
      { headers: _headers() }
    )
  }
}

/**
 * Push the current proxy list (any iterable of URL strings) to the
 * Vercel project's PROXIES env var. Comma-separated, deduped, in
 * insertion order. Idempotent.
 *
 * Returns { synced: true } on success, { synced: false, reason } when
 * skipped or failed.
 */
async function syncProxiesToVercel(proxyUrls) {
  const gate = shouldSync()
  if (!gate.ok) return { synced: false, reason: gate.reason }
  try {
    const list = [...new Set((proxyUrls || []).filter(Boolean))]
    const value = list.join(',')
    await _writeEnv(ENV_KEY, value)
    logger.success(`Synced PROXIES to Vercel (${list.length} entries)`, 'VERCEL')
    return { synced: true, count: list.length }
  } catch (err) {
    logger.error(`Vercel PROXIES sync failed: ${err.message}`, 'VERCEL')
    return { synced: false, reason: 'api_error', error: err.message }
  }
}

module.exports = {
  syncProxiesToVercel,
  shouldSync,
}