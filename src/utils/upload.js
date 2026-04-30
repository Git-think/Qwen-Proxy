const axios = require('axios')
const OSS = require('ali-oss')
const mimetypes = require('mime-types')
const { logger } = require('./logger')
const { generateUUID } = require('./tools.js')
const { getProxyAgent, getChatBaseUrl } = require('./proxy-helper')

// Configuration constants
const UPLOAD_CONFIG = {
    get stsTokenUrl() {
        return `${getChatBaseUrl()}/api/v1/files/getstsToken`
    },
    maxRetries: 3,
    timeout: 30000,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    retryDelay: 1000
}

// Supported file types
const SUPPORTED_TYPES = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
    video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/flv'],
    audio: ['audio/mp3', 'audio/wav', 'audio/aac', 'audio/ogg'],
    document: ['application/pdf', 'text/plain', 'application/msword']
}

/**
 * Validate file size
 * @param {number} fileSize - File size in bytes
 * @returns {boolean} Whether within size limit
 */
const validateFileSize = (fileSize) => {
    return fileSize > 0 && fileSize <= UPLOAD_CONFIG.maxFileSize
}

/**
 * Get simplified file type from MIME type
 * @param {string} mimeType - Full MIME type
 * @returns {string} Simplified file type
 */
const getSimpleFileType = (mimeType) => {
    if (!mimeType) return 'file'
    const mainType = mimeType.split('/')[0].toLowerCase()
    if (Object.keys(SUPPORTED_TYPES).includes(mainType)) {
        return mainType
    }
    return 'file'
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Request STS Token (with retry)
 * @param {string} filename - Filename
 * @param {number} filesize - File size in bytes
 * @param {string} filetypeSimple - Simplified file type
 * @param {string} authToken - Auth token
 * @param {number} retryCount - Retry count
 * @returns {Promise<Object>} STS Token response data
 */
const requestStsToken = async (filename, filesize, filetypeSimple, authToken, retryCount = 0) => {
    try {
        if (!filename || !authToken) {
            throw new Error('Filename and auth token are required')
        }

        if (!validateFileSize(filesize)) {
            throw new Error(`File size exceeds limit, max ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`)
        }

        const requestId = generateUUID()
        const bearerToken = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`
        const proxyAgent = getProxyAgent()

        const headers = {
            'Authorization': bearerToken,
            'Content-Type': 'application/json',
            'x-request-id': requestId,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }

        const payload = {
            filename,
            filesize,
            filetype: filetypeSimple
        }

        const requestConfig = {
            headers,
            timeout: UPLOAD_CONFIG.timeout
        }

        if (proxyAgent) {
            requestConfig.httpsAgent = proxyAgent
            requestConfig.proxy = false
        }

        logger.info(`Requesting STS Token: ${filename} (${filesize} bytes, ${filetypeSimple})`, 'UPLOAD')

        const response = await axios.post(UPLOAD_CONFIG.stsTokenUrl, payload, requestConfig)

        if (response.status === 200 && response.data) {
            const stsData = response.data

            const credentials = {
                access_key_id: stsData.access_key_id,
                access_key_secret: stsData.access_key_secret,
                security_token: stsData.security_token
            }

            const fileInfo = {
                url: stsData.file_url,
                path: stsData.file_path,
                bucket: stsData.bucketname,
                endpoint: stsData.region + '.aliyuncs.com',
                id: stsData.file_id
            }

            const requiredCredentials = ['access_key_id', 'access_key_secret', 'security_token']
            const requiredFileInfo = ['url', 'path', 'bucket', 'endpoint', 'id']

            const missingCredentials = requiredCredentials.filter(key => !credentials[key])
            const missingFileInfo = requiredFileInfo.filter(key => !fileInfo[key])

            if (missingCredentials.length > 0 || missingFileInfo.length > 0) {
                throw new Error(`STS response incomplete: missing ${[...missingCredentials, ...missingFileInfo].join(', ')}`)
            }

            logger.success('STS Token obtained successfully', 'UPLOAD')
            return { credentials, file_info: fileInfo }
        } else {
            throw new Error(`Failed to get STS Token, status: ${response.status}`)
        }
    } catch (error) {
        logger.error(`STS Token request failed (retry: ${retryCount})`, 'UPLOAD', '', error)

        if (error.response?.status === 403) {
            throw new Error('Authentication failed, please check token permissions')
        }

        if (retryCount < UPLOAD_CONFIG.maxRetries &&
            (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' ||
                error.response?.status >= 500)) {

            const delayMs = UPLOAD_CONFIG.retryDelay * Math.pow(2, retryCount)
            logger.warn(`Waiting ${delayMs}ms before retry...`, 'UPLOAD')
            await delay(delayMs)

            return requestStsToken(filename, filesize, filetypeSimple, authToken, retryCount + 1)
        }

        throw error
    }
}

/**
 * Upload file buffer to Alibaba Cloud OSS using STS credentials
 * @param {Buffer} fileBuffer - File content buffer
 * @param {Object} stsCredentials - STS credentials
 * @param {Object} ossInfo - OSS info
 * @param {string} fileContentTypeFull - Full MIME type
 * @param {number} retryCount - Retry count
 * @returns {Promise<Object>} Upload result
 */
const uploadToOssWithSts = async (fileBuffer, stsCredentials, ossInfo, fileContentTypeFull, retryCount = 0) => {
    try {
        if (!fileBuffer || !stsCredentials || !ossInfo) {
            throw new Error('Missing required upload parameters')
        }

        const client = new OSS({
            accessKeyId: stsCredentials.access_key_id,
            accessKeySecret: stsCredentials.access_key_secret,
            stsToken: stsCredentials.security_token,
            bucket: ossInfo.bucket,
            endpoint: ossInfo.endpoint,
            secure: true,
            timeout: UPLOAD_CONFIG.timeout
        })

        logger.info(`Uploading to OSS: ${ossInfo.path} (${fileBuffer.length} bytes)`, 'UPLOAD')

        const result = await client.put(ossInfo.path, fileBuffer, {
            headers: {
                'Content-Type': fileContentTypeFull || 'application/octet-stream'
            }
        })

        if (result.res && result.res.status === 200) {
            logger.success('File uploaded to OSS successfully', 'UPLOAD')
            return { success: true, result }
        } else {
            throw new Error(`OSS upload failed, status: ${result.res?.status || 'unknown'}`)
        }
    } catch (error) {
        logger.error(`OSS upload failed (retry: ${retryCount})`, 'UPLOAD', '', error)

        if (retryCount < UPLOAD_CONFIG.maxRetries) {
            const delayMs = UPLOAD_CONFIG.retryDelay * Math.pow(2, retryCount)
            logger.warn(`Waiting ${delayMs}ms before OSS upload retry...`, 'UPLOAD')
            await delay(delayMs)

            return uploadToOssWithSts(fileBuffer, stsCredentials, ossInfo, fileContentTypeFull, retryCount + 1)
        }

        throw error
    }
}

/**
 * Complete file upload flow: Get STS Token -> Upload to OSS
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} originalFilename - Original filename
 * @param {string} authToken - Qwen auth token
 * @returns {Promise<{file_url: string, file_id: string, message: string}>} Upload result
 */
const uploadFileToQwenOss = async (fileBuffer, originalFilename, authToken) => {
    try {
        if (!fileBuffer || !originalFilename || !authToken) {
            throw new Error('Missing required upload parameters')
        }

        const filesize = fileBuffer.length
        const mimeType = mimetypes.lookup(originalFilename) || 'application/octet-stream'
        const filetypeSimple = getSimpleFileType(mimeType)

        if (!validateFileSize(filesize)) {
            throw new Error(`File size exceeds limit, max ${UPLOAD_CONFIG.maxFileSize / 1024 / 1024}MB`)
        }

        logger.info(`Starting file upload: ${originalFilename} (${filesize} bytes, ${mimeType})`, 'UPLOAD')

        // Step 1: Get STS Token
        const { credentials, file_info } = await requestStsToken(
            originalFilename,
            filesize,
            filetypeSimple,
            authToken
        )

        // Step 2: Upload to OSS
        await uploadToOssWithSts(fileBuffer, credentials, file_info, mimeType)

        logger.success('File upload flow complete', 'UPLOAD')

        return {
            status: 200,
            file_url: file_info.url,
            file_id: file_info.id,
            message: 'File uploaded successfully'
        }
    } catch (error) {
        logger.error('File upload flow failed', 'UPLOAD', '', error)
        throw error
    }
}

module.exports = {
    uploadFileToQwenOss
}
