const express = require('express')
const router = express.Router()
const { validateApiKey } = require('../middlewares/authorization')

/**
 * POST /verify
 * Body: { apiKey: string }
 * Response on success (200):
 *   { valid: true, isAdmin: boolean, status: 200, message: 'success' }
 * Response on failure (401):
 *   { valid: false, isAdmin: false, status: 401, message: 'Unauthorized' }
 *
 * The `valid` + `isAdmin` shape is the documented public contract used
 * by the frontend Login page. The legacy `status` + `message` fields are
 * preserved for backward compat with existing scripts.
 */
router.post('/verify', (req, res) => {
  const apiKey = req.body.apiKey
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid) {
    return res.status(401).json({
      valid: false,
      isAdmin: false,
      status: 401,
      message: 'Unauthorized'
    })
  }

  res.status(200).json({
    valid: true,
    isAdmin,
    status: 200,
    message: 'success'
  })
})

module.exports = router
