const dotenv = require('dotenv')
dotenv.config()

/**
 * Parse API_KEY env var, supports comma-separated multiple keys
 * @returns {Object} Object containing apiKeys array and adminKey
 */
const parseApiKeys = () => {
    const apiKeyEnv = process.env.API_KEY
    if (!apiKeyEnv) {
        return { apiKeys: [], adminKey: null }
    }

    const keys = apiKeyEnv.split(',').map(key => key.trim()).filter(key => key.length > 0)
    return {
        apiKeys: keys,
        adminKey: keys.length > 0 ? keys[0] : null
    }
}

/**
 * Parse proxy list from env. Accepts:
 *   PROXIES=socks5://1.2.3.4:1080,http://user:pass@host:port,...
 *   (legacy) PROXY_URL=<single>
 * Returns deduped array of normalized URLs. Each entry must be a parseable
 * URL with a known scheme (socks5/socks4/socks/http/https).
 */
const parseProxies = () => {
    const raw = []
    const env = process.env.PROXIES
    if (env) {
        raw.push(...env.split(',').map(s => s.trim()).filter(Boolean))
    }
    if (process.env.PROXY_URL) {
        raw.push(String(process.env.PROXY_URL).trim())
    }
    const seen = new Set()
    const out = []
    for (const url of raw) {
        if (!url || seen.has(url)) continue
        try {
            const u = new URL(url)
            if (!/^(socks5h?|socks4a?|socks|http|https):$/.test(u.protocol)) continue
            seen.add(url)
            out.push(url)
        } catch { /* invalid url — skip */ }
    }
    return out
}

const { apiKeys, adminKey } = parseApiKeys()

const config = {
    dataSaveMode: process.env.DATA_SAVE_MODE || "none",
    apiKeys: apiKeys,
    adminKey: adminKey,
    batchLoginConcurrency: Math.max(1, parseInt(process.env.BATCH_LOGIN_CONCURRENCY) || 5),
    simpleModelMap: process.env.SIMPLE_MODEL_MAP === 'true' ? true : false,
    listenAddress: process.env.LISTEN_ADDRESS || null,
    listenPort: process.env.SERVICE_PORT || process.env.PORT || 3000,
    searchInfoMode: process.env.SEARCH_INFO_MODE === 'table' ? "table" : "text",
    outThink: process.env.OUTPUT_THINK === 'true' ? true : false,
    autoRefresh: true,
    autoRefreshInterval: 6 * 60 * 60,
    cacheMode: "default",
    logLevel: process.env.LOG_LEVEL || "INFO",
    enableFileLog: process.env.ENABLE_FILE_LOG === 'true',
    logDir: process.env.LOG_DIR || "./logs",
    maxLogFileSize: parseInt(process.env.MAX_LOG_FILE_SIZE) || 10,
    maxLogFiles: parseInt(process.env.MAX_LOG_FILES) || 5,
    // Custom reverse proxy URL config
    qwenChatProxyUrl: process.env.QWEN_CHAT_PROXY_URL || "https://chat.qwen.ai",
    // Single-proxy legacy field (kept for getProxyAgent backward compat)
    proxyUrl: process.env.PROXY_URL || null,
    // Smart proxy pool: list of proxy URLs (PROXIES env + PROXY_URL fallback,
    // deduped). Each account gets bound to one entry from this pool.
    proxies: parseProxies(),
    // Maximum upstream-request retries when network errors look proxy-related
    proxyMaxRetries: Math.max(1, parseInt(process.env.PROXY_MAX_RETRIES) || 3),
    // Serverless platform detection — Vercel, Netlify, AWS Lambda all
    // share the same "ephemeral container, no persistent disk" property
    // that makes DATA_SAVE_MODE=file unsafe.
    isServerless: !!(
        process.env.VERCEL
        || process.env.NETLIFY
        || process.env.AWS_LAMBDA_FUNCTION_NAME
    )
}

module.exports = config
