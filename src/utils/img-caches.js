/**
 * Image Cache Manager
 * In-memory only cache for serverless compatibility
 */
class ImgCacheManager {
  constructor() {
    this.cacheMap = new Map()
  }

  cacheIsExist(signature) {
    return this.cacheMap.has(signature)
  }

  addCache(signature, url) {
    if (this.cacheIsExist(signature)) {
      return false
    }
    this.cacheMap.set(signature, url)
    return true
  }

  getCache(signature) {
    if (this.cacheIsExist(signature)) {
      return {
        status: 200,
        url: this.cacheMap.get(signature)
      }
    }
    return {
      status: 404,
      url: null
    }
  }
}

module.exports = ImgCacheManager
