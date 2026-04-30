const express = require('express')
const router = express.Router()
const { apiKeyVerify } = require('../middlewares/authorization')
const { handleGetModels } = require('../controllers/models.js')

router.get('/v1/models', apiKeyVerify, handleGetModels)
router.get('/models', handleGetModels)

module.exports = router
