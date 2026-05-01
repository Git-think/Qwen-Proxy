'use strict'

const axios = require('axios')
const { logger } = require('./logger')
const { buildAgentForUrl, getProxyHost } = require('./proxy-helper')

/**
 * Smart proxy pool — port of the old branch's ProxyManager
 * (https://github.com/Git-think/Qwen-Proxy/tree/old).
 *
 * Responsibilities:
 *   - hold a deduped pool of proxy URLs (any of socks5/socks4/http/https)
 *   - per-proxy health: 'untested' | 'available' | 'failed'
 *   - per-account binding so each account stays on a stable IP
 *   - four-tier assignProxy priority:
 *        P1 verified-available + unused (exclusive)
 *        P2 untested (probe, possibly promote)
 *        P3 failed (re-probe, possibly recover)
 *        P4 verified-available + shared (least-loaded first)
 *   - persistence of statuses + bindings via the supplied DataPersistence
 *     instance (no-op on file-mode-disabled / serverless)
 *   - markProxyAsFailed: record-and-persist for the request layer
 *
 * The pool does NOT itself re-test proxies on a timer; failed proxies are
 * only re-tried lazily on the next assignProxy call that lands on them.
 */
class ProxyPool {
  constructor(dataPersistence, initialProxies = []) {
    /** @type {Map<string, {url:string, status:string, assignedAccounts:Set<string>}>} */
    this.proxies = new Map()
    /** @type {Map<string, string>} email -> proxyUrl */
    this.proxyAssignment = new Map()
    this.dataPersistence = dataPersistence

    for (const url of initialProxies) {
      if (!url || this.proxies.has(url)) continue
      this.proxies.set(url, { url, status: 'untested', assignedAccounts: new Set() })
    }
  }

  size() { return this.proxies.size }

  /**
   * Replay persisted statuses + bindings into the in-memory state.
   */
  async initialize(savedStatuses = {}, savedBindings = {}) {
    for (const [url, status] of Object.entries(savedStatuses)) {
      const p = this.proxies.get(url)
      if (p && ['untested', 'available', 'failed'].includes(status)) {
        p.status = status
      }
    }
    for (const [email, url] of Object.entries(savedBindings)) {
      const p = this.proxies.get(url)
      if (p) {
        this.proxyAssignment.set(email, url)
        p.assignedAccounts.add(email)
      }
    }
    logger.success(`Proxy pool initialized with ${this.proxies.size} entries`, 'PROXY')
  }

  /**
   * Probe a proxy by issuing a GET against a generic 204 endpoint. We use
   * www.gstatic.com/generate_204 and www.cloudflare.com/cdn-cgi/trace as
   * fallbacks — they're tiny, globally distributed, and don't rate-limit.
   * Returns true if the request lands successfully through the proxy.
   * Side effect: writes the result into proxies.get(url).status and
   * persists.
   */
  async _testProxy(url) {
    const entry = this.proxies.get(url)
    if (!entry) return false
    const agent = buildAgentForUrl(url)
    if (!agent) {
      entry.status = 'failed'
      await this._persistStatuses()
      return false
    }
    const probes = [
      { url: 'https://www.gstatic.com/generate_204', expect: [204] },
      { url: 'https://www.cloudflare.com/cdn-cgi/trace', expect: [200] },
    ]
    for (const probe of probes) {
      try {
        const res = await axios.get(probe.url, {
          httpAgent: agent,
          httpsAgent: agent,
          proxy: false,
          timeout: 8000,
          validateStatus: s => probe.expect.includes(s),
        })
        if (probe.expect.includes(res.status)) {
          entry.status = 'available'
          await this._persistStatuses()
          logger.info(`Proxy ${getProxyHost(url)} OK`, 'PROXY')
          return true
        }
      } catch (err) {
        // try next probe
      }
    }
    entry.status = 'failed'
    await this._persistStatuses()
    logger.warn(`Proxy ${getProxyHost(url)} failed all probes`, 'PROXY')
    return false
  }

  /**
   * Hand out a proxy to an account. Already-bound assignments are reused
   * unless forceNew is true. The four-tier priority below balances
   * exclusivity with discovery and recovery.
   *
   * Returns the proxyUrl on success, or null when no candidate works.
   */
  async assignProxy(email, forceNew = false) {
    if (this.proxies.size === 0) return null

    if (this.proxyAssignment.has(email) && !forceNew) {
      return this.proxyAssignment.get(email)
    }

    // Tear down old binding before searching for a replacement.
    if (this.proxyAssignment.has(email)) {
      const oldUrl = this.proxyAssignment.get(email)
      const oldEntry = this.proxies.get(oldUrl)
      if (oldEntry) oldEntry.assignedAccounts.delete(email)
      this.proxyAssignment.delete(email)
    }

    const all = [...this.proxies.values()]

    // P1: verified-available + unused (exclusive).
    const exclusive = all.filter(p => p.status === 'available' && p.assignedAccounts.size === 0)
    for (const p of this._shuffle(exclusive)) {
      if (await this._testProxy(p.url)) return this._bind(email, p)
    }

    // P2: untested (probe).
    const untested = all.filter(p => p.status === 'untested')
    for (const p of this._shuffle(untested)) {
      if (await this._testProxy(p.url)) return this._bind(email, p)
    }

    // P3: failed (re-probe; failures may have been transient).
    const failed = all.filter(p => p.status === 'failed')
    for (const p of this._shuffle(failed)) {
      if (await this._testProxy(p.url)) return this._bind(email, p)
    }

    // P4: verified-available + shared, least-loaded first.
    const shared = all
      .filter(p => p.status === 'available')
      .sort((a, b) => a.assignedAccounts.size - b.assignedAccounts.size)
    for (const p of shared) {
      if (await this._testProxy(p.url)) return this._bind(email, p)
    }

    logger.error(`No usable proxy for account ${email}`, 'PROXY')
    return null
  }

  _bind(email, entry) {
    this.proxyAssignment.set(email, entry.url)
    entry.assignedAccounts.add(email)
    if (this.dataPersistence && this.dataPersistence.saveProxyBinding) {
      // Fire-and-forget; persistence errors are logged inside the helper.
      this.dataPersistence.saveProxyBinding(email, entry.url).catch(() => {})
    }
    logger.info(`Bound ${email} -> ${getProxyHost(entry.url)}`, 'PROXY')
    return entry.url
  }

  getProxyForAccount(email) {
    return this.proxyAssignment.get(email) || null
  }

  /**
   * Mark a proxy as failed (typically called from the request layer after
   * a network error). The next assignProxy will skip it on P1 (still
   * available?) and fall through to P3 for a re-probe — failures don't
   * permanently remove a proxy from the pool.
   */
  async markProxyAsFailed(url) {
    const entry = this.proxies.get(url)
    if (!entry) return
    entry.status = 'failed'
    await this._persistStatuses()
    logger.warn(`Proxy ${getProxyHost(url)} marked failed`, 'PROXY')
  }

  /** @private */
  async _persistStatuses() {
    if (!this.dataPersistence || !this.dataPersistence.saveProxyStatuses) return
    const out = {}
    for (const [url, p] of this.proxies.entries()) out[url] = p.status
    try { await this.dataPersistence.saveProxyStatuses(out) } catch { /* logged inside */ }
  }

  /**
   * Add a new proxy at runtime (e.g. via admin API). Idempotent.
   */
  async addProxy(url) {
    if (!url || this.proxies.has(url)) return false
    this.proxies.set(url, { url, status: 'untested', assignedAccounts: new Set() })
    await this._persistStatuses()
    return true
  }

  /**
   * Remove a proxy. Any accounts bound to it are unbound and the binding
   * is cleared in persistence so they don't dangle.
   */
  async removeProxy(url) {
    const entry = this.proxies.get(url)
    if (!entry) return false
    for (const email of entry.assignedAccounts) {
      this.proxyAssignment.delete(email)
      if (this.dataPersistence && this.dataPersistence.saveProxyBinding) {
        try { await this.dataPersistence.saveProxyBinding(email, null) } catch { /* logged */ }
      }
    }
    this.proxies.delete(url)
    await this._persistStatuses()
    return true
  }

  /**
   * Snapshot for the admin UI — never includes embedded credentials in
   * the visible host (logs use getProxyHost too).
   */
  list() {
    return [...this.proxies.values()].map(p => ({
      url: p.url,
      host: getProxyHost(p.url),
      status: p.status,
      assignedAccounts: [...p.assignedAccounts],
    }))
  }

  /** @private */
  _shuffle(arr) {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
}

module.exports = ProxyPool
