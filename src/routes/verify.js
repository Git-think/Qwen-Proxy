const express = require('express')
const router = express.Router()
const { validateApiKey } = require('../middlewares/authorization')

router.post('/verify', (req, res) => {
  const apiKey = req.body.apiKey
  const { isValid, isAdmin } = validateApiKey(apiKey)

  if (!isValid) {
    return res.status(401).json({
      status: 401,
      message: 'Unauthorized'
    })
  }

  res.status(200).json({
    status: 200,
    message: 'success',
    isAdmin: isAdmin
  })
})

module.exports = router
