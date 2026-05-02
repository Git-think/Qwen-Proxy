const express = require('express')
const router = express.Router()
const axios = require('axios')
const { adminKeyVerify } = require('../middlewares/authorization')
const redisClient = require('../utils/redis-client')
const config = require('../config/index.js')
const accountManager = require('../utils/account.js')
const { syncAccountsToVercel, syncProxiesToVercel, syncDisabledAccountsToVercel } = require('../utils/vercel-sync')
const { logger } = require('../utils/logger')

function getVercelConfig() {
  return {
    vercelToken: process.env.VERCEL_TOKEN || null,
    projectId: process.env.VERCEL_PROJECT_ID || null,
    teamId: process.env.VERCEL_TEAM_ID || null,
  }
}

// Public lightweight info endpoint. Returns identifying flags AND the
// non-secret values (projectId, teamId) so operators can confirm at a
// glance that the env vars they set match the Vercel project they intend
// to manage. The token is never exposed — only its presence (hasToken).
// Mounted under /api/vercel/info.
router.get('/vercel/info', (req, res) => {
  const { vercelToken, projectId, teamId } = getVercelConfig()
  res.json({
    isVercel: !!(process.env.VERCEL),
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelUrl: process.env.VERCEL_URL || null,
    configured: !!(vercelToken && projectId),
    hasToken: !!vercelToken,
    hasProjectId: !!projectId,
    hasTeamId: !!teamId,
    // Redis-mode flag so the frontend can hide the Vercel sync nav when
    // redis already covers persistence (no need for the operator to also
    // mutate ACCOUNTS / PROXIES via the Vercel API).
    redisConfigured: config.dataSaveMode === 'redis' && redisClient.isConfigured(),
    dataSaveMode: config.dataSaveMode,
    // Non-secret identifiers — safe to expose so the UI can render them
    // for visual confirmation. Project ID is also visible in the dashboard
    // URL, and Team ID is exposed in account-level URLs, so neither is
    // sensitive in the same way the token is.
    projectId: projectId || null,
    teamId: teamId || null,
  })
})

router.get('/vercel/status', adminKeyVerify, async (req, res) => {
  const { vercelToken, projectId, teamId } = getVercelConfig()
  res.json({
    configured: !!(vercelToken && projectId),
    hasToken: !!vercelToken,
    hasProjectId: !!projectId,
    hasTeamId: !!teamId,
    isVercel: !!(process.env.VERCEL),
    // Same non-secret IDs as /vercel/info — surfaced here too so the
    // admin page can render visual confirmation in one round-trip
    // instead of needing a second public call.
    projectId: projectId || null,
    teamId: teamId || null,
    vercelEnv: process.env.VERCEL_ENV || null,
    vercelUrl: process.env.VERCEL_URL || null,
  })
})

router.get('/vercel/env', adminKeyVerify, async (req, res) => {
  try {
    const { vercelToken, projectId, teamId } = getVercelConfig()
    if (!vercelToken || !projectId) {
      return res.status(400).json({ error: '未配置 VERCEL_TOKEN 或 VERCEL_PROJECT_ID' })
    }
    const url = teamId
      ? `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}`
      : `https://api.vercel.com/v9/projects/${projectId}/env`
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${vercelToken}` }
    })
    const envs = (response.data.envs || []).map(env => ({
      id: env.id,
      key: env.key,
      value: env.value || '',
      target: env.target,
      type: env.type,
    }))
    res.json({ envs })
  } catch (error) {
    logger.error('获取 Vercel 环境变量失败', 'VERCEL', '', error.message)
    res.status(500).json({ error: error.response?.data?.error?.message || error.message })
  }
})

router.post('/vercel/env', adminKeyVerify, async (req, res) => {
  try {
    const { vercelToken, projectId, teamId } = getVercelConfig()
    if (!vercelToken || !projectId) {
      return res.status(400).json({ error: '未配置 VERCEL_TOKEN 或 VERCEL_PROJECT_ID' })
    }
    const { key, value, target = ['production', 'preview', 'development'], type = 'encrypted' } = req.body
    if (!key || value === undefined) {
      return res.status(400).json({ error: '缺少 key 或 value' })
    }
    const baseUrl = teamId
      ? `https://api.vercel.com/v9/projects/${projectId}/env?teamId=${teamId}`
      : `https://api.vercel.com/v9/projects/${projectId}/env`
    const headers = { Authorization: `Bearer ${vercelToken}` }
    const existing = await axios.get(baseUrl, { headers })
    const existingEnv = (existing.data.envs || []).find(e => e.key === key)
    if (existingEnv) {
      const updateUrl = teamId
        ? `https://api.vercel.com/v9/projects/${projectId}/env/${existingEnv.id}?teamId=${teamId}`
        : `https://api.vercel.com/v9/projects/${projectId}/env/${existingEnv.id}`
      await axios.patch(updateUrl, { value, target, type }, { headers })
    } else {
      await axios.post(baseUrl, { key, value, target, type }, { headers })
    }
    res.json({ success: true, key })
  } catch (error) {
    logger.error('更新 Vercel 环境变量失败', 'VERCEL', '', error.message)
    res.status(500).json({ error: error.response?.data?.error?.message || error.message })
  }
})

router.post('/vercel/redeploy', adminKeyVerify, async (req, res) => {
  try {
    const { vercelToken, projectId, teamId } = getVercelConfig()
    if (!vercelToken || !projectId) {
      return res.status(400).json({ error: '未配置 VERCEL_TOKEN 或 VERCEL_PROJECT_ID' })
    }
    const deploymentsUrl = teamId
      ? `https://api.vercel.com/v6/deployments?projectId=${projectId}&teamId=${teamId}&limit=1`
      : `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1`
    const deploymentsRes = await axios.get(deploymentsUrl, {
      headers: { Authorization: `Bearer ${vercelToken}` }
    })
    const latest = deploymentsRes.data.deployments?.[0]
    if (!latest) {
      return res.status(404).json({ error: '未找到部署记录' })
    }
    const redeployUrl = teamId
      ? `https://api.vercel.com/v13/deployments?teamId=${teamId}&forceNew=1`
      : `https://api.vercel.com/v13/deployments?forceNew=1`
    const redeployRes = await axios.post(redeployUrl, {
      name: latest.name,
      target: 'production',
      deploymentId: latest.uid,
    }, {
      headers: { Authorization: `Bearer ${vercelToken}` }
    })
    res.json({
      success: true,
      deploymentId: redeployRes.data.id,
      url: redeployRes.data.url
    })
  } catch (error) {
    logger.error('触发 Vercel 重新部署失败', 'VERCEL', '', error.message)
    res.status(500).json({ error: error.response?.data?.error?.message || error.message })
  }
})

/**
 * POST /vercel/syncNow - Manually push current in-memory state into the
 * Vercel project's env vars. Operator-driven (each env write triggers a
 * fresh build, ~60s startup) — auto-sync on every mutation would amplify
 * deploys and slow the system down.
 *
 * Body: { scopes?: ['accounts'|'proxies'|'disabled'] }
 *   - omitted / 'all' / [] → sync all three
 *
 * Per-scope result object: { synced: bool, count?: number, reason?: string }
 */
router.post('/vercel/syncNow', adminKeyVerify, async (req, res) => {
  try {
    const requested = req.body && req.body.scopes
    const all = !requested || requested === 'all' || (Array.isArray(requested) && requested.length === 0)
    const wants = (name) => all || (Array.isArray(requested) && requested.includes(name))

    const result = {}
    if (wants('accounts')) {
      result.accounts = await syncAccountsToVercel(accountManager.getAllAccountKeys())
    }
    if (wants('disabled')) {
      result.disabled = await syncDisabledAccountsToVercel(accountManager.getDisabledEmails())
    }
    if (wants('proxies')) {
      const list = accountManager.proxyPool ? accountManager.proxyPool.list().map(p => p.url) : []
      result.proxies = await syncProxiesToVercel(list)
    }
    res.json({ success: true, result })
  } catch (error) {
    logger.error('Vercel syncNow failed', 'VERCEL', '', error)
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
