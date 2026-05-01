const express = require('express')
const router = express.Router()
const axios = require('axios')
const { adminKeyVerify } = require('../middlewares/authorization')
const { logger } = require('../utils/logger')

function getVercelConfig() {
  return {
    vercelToken: process.env.VERCEL_TOKEN || null,
    projectId: process.env.VERCEL_PROJECT_ID || null,
    teamId: process.env.VERCEL_TEAM_ID || null,
  }
}

// Public lightweight info endpoint. Returns boolean flags only — no values.
// Used by the frontend Sidebar to decide whether to show the Vercel link
// without requiring the admin API key. Mounted under /api/vercel/info.
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

module.exports = router
