'use strict'

/**
 * DSML tool-call adapter for Qwen.
 * Inspired by github.com/CJackHwang/ds2api (Go); minimal Node port.
 *
 * Activation gate: callers MUST first check hasTools(reqBody). If false, do
 * NOT call any other function in this module — behavior must be 100%
 * passthrough so non-tool callers see no protocol drift.
 */

const TC_OPEN = '<|DSML|tool_calls>'
const TC_CLOSE = '</|DSML|tool_calls>'

/* ---------------- gate ---------------- */
function hasTools(reqBody) {
  return Array.isArray(reqBody && reqBody.tools) && reqBody.tools.length > 0
}

/* ---------------- tool-name obfuscation ----------------
 * Qwen upstream validates tool names against an internal registry and
 * rejects common short ones (Read/Write/Bash/Edit/Grep/...) with
 * "Tool X does not exists.". We rewrite outbound names so the model sees
 * names that don't collide with Qwen's built-in checks, and reverse the
 * mapping on the inbound tool_calls so the client receives its original
 * tool ids.
 *
 * Applied:
 *   outbound: prompt's tool schema + history's assistant.tool_calls
 *   inbound : parseToolCallsBlock results + streaming sieve emissions
 */
const TOOL_ALIAS_OUT = {
  Read: 'fs_open_file',
  Write: 'fs_write_file',
  Edit: 'fs_edit_file',
  MultiEdit: 'fs_multi_edit',
  Bash: 'shell_run',
  BashOutput: 'shell_output',
  KillShell: 'shell_kill',
  Grep: 'text_search',
  Glob: 'fs_glob',
  LS: 'fs_list',
  WebFetch: 'http_fetch',
  WebSearch: 'web_search',
  TodoWrite: 'todo_write',
  Task: 'agent_task',
  NotebookEdit: 'notebook_edit',
  NotebookRead: 'notebook_read',
  ExitPlanMode: 'plan_exit',
  SlashCommand: 'slash_command',
}
const TOOL_ALIAS_IN = Object.fromEntries(
  Object.entries(TOOL_ALIAS_OUT).map(([k, v]) => [v, k])
)

// NOTE on the dropped `t_` catch-all prefix:
// An earlier revision prefixed every non-aliased tool name with `t_` to
// dodge Qwen's internal tool-name validator. That worked on smaller Qwen
// variants (e.g. qwen3.6-27b) but qwen3.6-plus had been trained to treat
// `t_` as a tool namespace, and would refuse with "Tool t_X does not
// exists." even though our prompt declared the tool. We now pass
// non-aliased names through verbatim — Qwen does NOT see req.body.tools
// (chat-middleware strips it) so there's no backend validator to dodge.

function obfuscateToolName(name) {
  if (!name || typeof name !== 'string') return name
  if (Object.prototype.hasOwnProperty.call(TOOL_ALIAS_OUT, name)) return TOOL_ALIAS_OUT[name]
  // Already an aliased upstream id — leave untouched.
  if (Object.prototype.hasOwnProperty.call(TOOL_ALIAS_IN, name)) return name
  return name
}

function deobfuscateToolName(name) {
  if (!name || typeof name !== 'string') return name
  if (Object.prototype.hasOwnProperty.call(TOOL_ALIAS_IN, name)) return TOOL_ALIAS_IN[name]
  // Backward compat: parse legacy `t_` prefix that historical responses
  // may have produced, so a stale prompt cache from an older deploy
  // doesn't suddenly look broken.
  if (name.startsWith('t_')) return name.slice(2)
  return name
}

/* ---------------- prompt build ---------------- */
function buildToolPromptBlock(tools) {
  const decls = (tools || []).map(t => {
    const fn = t.function || t
    const originalName = (fn && fn.name) || ''
    const name = obfuscateToolName(originalName)
    const desc = (fn && fn.description) || ''
    const params = fn && (fn.parameters || fn.input_schema)
    let paramsBlock = '{}'
    if (params) { try { paramsBlock = JSON.stringify(params) } catch { /* keep default */ } }
    return `- ${name}: ${desc}\n  parameters: ${paramsBlock}`
  }).join('\n')

  return [
    'You may call tools. When you decide to call a tool, output the call EXACTLY in this format and stop:',
    '',
    '<|DSML|tool_calls>',
    '  <|DSML|invoke name="TOOL_NAME">',
    '    <|DSML|parameter name="ARG_NAME"><![CDATA[ARG_VALUE]]></|DSML|parameter>',
    '  </|DSML|invoke>',
    '</|DSML|tool_calls>',
    '',
    'Rules:',
    '1. Wrap one or more <|DSML|invoke> in a single <|DSML|tool_calls> block.',
    '2. String parameters MUST use <![CDATA[...]]>. Numbers / booleans / null are plain text.',
    '3. Object parameters: nest XML elements inside the <|DSML|parameter>. Arrays: repeat <item>.',
    '4. Use only parameter names from the schemas below.',
    '5. Do NOT wrap in markdown fences. Do NOT explain.',
    '6. If you call a tool, the block must be the last thing you output.',
    '',
    'Tools available:',
    decls,
  ].join('\n')
}

/* ---------------- history serialization ---------------- */
function serializeAssistantToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return ''
  const blocks = []
  for (const tc of toolCalls) {
    const fn = tc.function || tc
    const originalName = String((fn && fn.name) || '').trim()
    if (!originalName) continue
    const name = obfuscateToolName(originalName)
    let args = fn && fn.arguments
    if (typeof args === 'string') {
      const repaired = tryJsonRepair(args)
      args = repaired === undefined ? args : repaired
    }
    blocks.push(renderInvoke(name, args))
  }
  if (blocks.length === 0) return ''
  return TC_OPEN + '\n' + blocks.join('\n') + '\n' + TC_CLOSE
}

function serializeToolResult(msg) {
  const id = (msg && msg.tool_call_id) || ''
  let content = msg && msg.content
  if (content === null || content === undefined) content = ''
  if (typeof content !== 'string') {
    try { content = JSON.stringify(content) } catch { content = String(content) }
  }
  return `<|DSML|tool_result tool_use_id="${escapeAttr(id)}"><![CDATA[${escapeCDATA(content)}]]></|DSML|tool_result>`
}

function renderInvoke(name, args) {
  const lines = [`  <|DSML|invoke name="${escapeAttr(name)}">`]
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    for (const key of Object.keys(args)) {
      lines.push('    ' + renderParam(key, args[key]))
    }
  } else if (typeof args === 'string' && args.length > 0) {
    lines.push('    ' + renderParam('content', args))
  }
  lines.push('  </|DSML|invoke>')
  return lines.join('\n')
}

function renderParam(name, value) {
  if (value === null || value === undefined) {
    return `<|DSML|parameter name="${escapeAttr(name)}"></|DSML|parameter>`
  }
  if (typeof value === 'string') {
    return `<|DSML|parameter name="${escapeAttr(name)}"><![CDATA[${escapeCDATA(value)}]]></|DSML|parameter>`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `<|DSML|parameter name="${escapeAttr(name)}">${String(value)}</|DSML|parameter>`
  }
  // object / array → JSON-as-CDATA fallback (keeps round-trip simple)
  let json = '{}'
  try { json = JSON.stringify(value) } catch { /* keep default */ }
  return `<|DSML|parameter name="${escapeAttr(name)}"><![CDATA[${escapeCDATA(json)}]]></|DSML|parameter>`
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeCDATA(s) {
  return String(s).replace(/]]>/g, ']]]]><![CDATA[>')
}

/* ---------------- non-stream parser ---------------- */
function parseToolCallsFromText(text) {
  if (!text || typeof text !== 'string') return { content: text || '', toolCalls: [] }
  const last = findLastClosedBlock(text)
  if (!last) return { content: text, toolCalls: [] }
  const block = text.slice(last.start, last.end)
  const calls = parseToolCallsBlock(block)
  if (calls.length === 0) return { content: text, toolCalls: [] }
  // If wrapped in a markdown fence, extend the strip boundary to include the
  // fence markers so visible content doesn't get a dangling ``` left over.
  const exp = expandFenceBoundary(text, last.start, last.end)
  const content = text.slice(0, exp.start).replace(/\s+$/, '')
  return { content, toolCalls: calls }
}

function expandFenceBoundary(text, start, end) {
  // backward: skip whitespace right before <|DSML|tool_calls>,
  // then check for an opening fence ```[lang?]
  let bs = start
  while (bs > 0 && /[ \t\r\n]/.test(text[bs - 1])) bs--
  const open = text.slice(0, bs).match(/```[A-Za-z0-9_+-]*[ \t]*\r?\n?$/)
  if (!open) return { start, end }
  const fenceStart = bs - open[0].length

  // forward: skip whitespace right after </|DSML|tool_calls>,
  // then check for a closing fence ```
  let fe = end
  while (fe < text.length && /[ \t\r\n]/.test(text[fe])) fe++
  if (text.slice(fe, fe + 3) === '```') {
    let close = fe + 3
    if (text[close] === '\r') close++
    if (text[close] === '\n') close++
    return { start: fenceStart, end: close }
  }
  // Opening fence present but no matching close — still strip the opener
  return { start: fenceStart, end }
}

function findLastClosedBlock(text) {
  let lastStart = -1, lastEnd = -1
  let cursor = 0
  while (true) {
    const s = text.indexOf(TC_OPEN, cursor)
    if (s < 0) break
    const e = text.indexOf(TC_CLOSE, s + TC_OPEN.length)
    if (e < 0) break
    lastStart = s
    lastEnd = e + TC_CLOSE.length
    cursor = lastEnd
  }
  if (lastStart < 0) return null
  return { start: lastStart, end: lastEnd }
}

function parseToolCallsBlock(block) {
  let inner = block
  if (inner.startsWith(TC_OPEN)) inner = inner.slice(TC_OPEN.length)
  if (inner.endsWith(TC_CLOSE)) inner = inner.slice(0, -TC_CLOSE.length)

  const calls = []
  const invokeRe = /<\|DSML\|invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\|DSML\|invoke>/g
  let m
  while ((m = invokeRe.exec(inner)) !== null) {
    const rawName = m[1]
    const body = m[2]
    const params = parseParameters(body)
    // Reverse the outbound obfuscation so the OpenAI tool_calls returned
    // to the client carry the original tool ids the client sent.
    const name = deobfuscateToolName(rawName)
    calls.push({
      id: 'call_' + cryptoRandom(),
      type: 'function',
      function: { name, arguments: JSON.stringify(params) }
    })
  }
  return calls
}

function parseParameters(body) {
  const out = {}
  const paramRe = /<\|DSML\|parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/\|DSML\|parameter>/g
  let m
  while ((m = paramRe.exec(body)) !== null) {
    const key = m[1]
    const raw = m[2]
    out[key] = decodeParamValue(raw)
  }
  return out
}

function decodeParamValue(raw) {
  const cdataMatch = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  if (cdataMatch) {
    const s = cdataMatch[1]
    const j = tryJsonRepair(s)
    if (j !== undefined) return j
    return s
  }
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  const nested = tryParseNestedXML(trimmed)
  if (nested !== undefined) return nested
  return trimmed
}

function tryParseNestedXML(s) {
  if (s.startsWith('<item>')) {
    const items = []
    const re = /<item>([\s\S]*?)<\/item>/g
    let m
    while ((m = re.exec(s)) !== null) items.push(decodeParamValue(m[1]))
    if (items.length > 0) return items
  }
  const re = /<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/g
  const obj = {}
  let m, found = false
  while ((m = re.exec(s)) !== null) {
    found = true
    obj[m[1]] = decodeParamValue(m[2])
  }
  if (found) return obj
  return undefined
}

/* ---------------- JSON repair ---------------- */
function tryJsonRepair(s) {
  if (typeof s !== 'string') return undefined
  const t = s.trim()
  if (!t) return undefined
  if (!/^[\[{"]/.test(t) && !/^-?\d/.test(t) && t !== 'true' && t !== 'false' && t !== 'null') return undefined
  // Pass 1: as-is
  try { return JSON.parse(t) } catch { /* continue */ }
  // Pass 2: Python literals + trailing commas + single quotes
  let r = t
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/,(\s*[}\]])/g, '$1')
  r = repairQuotes(r)
  try { return JSON.parse(r) } catch { /* continue */ }
  // Pass 3: balance brackets
  r = balanceBrackets(r)
  try { return JSON.parse(r) } catch { /* give up */ }
  return undefined
}

function repairQuotes(s) {
  let out = ''
  let inDQ = false, inSQ = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (esc) { out += c; esc = false; continue }
    if (c === '\\') { out += c; esc = true; continue }
    if (!inDQ && !inSQ && c === '"') { inDQ = true; out += c; continue }
    if (inDQ && c === '"') { inDQ = false; out += c; continue }
    if (!inDQ && !inSQ && c === "'") { inSQ = true; out += '"'; continue }
    if (inSQ && c === "'") { inSQ = false; out += '"'; continue }
    if (inSQ && c === '"') { out += '\\"'; continue }
    out += c
  }
  return out
}

function balanceBrackets(s) {
  const stack = []
  let inDQ = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (esc) { esc = false; continue }
    if (inDQ) {
      if (c === '\\') { esc = true; continue }
      if (c === '"') inDQ = false
      continue
    }
    if (c === '"') { inDQ = true; continue }
    if (c === '{' || c === '[') stack.push(c)
    else if (c === '}' && stack[stack.length - 1] === '{') stack.pop()
    else if (c === ']' && stack[stack.length - 1] === '[') stack.pop()
  }
  let suffix = ''
  while (stack.length) {
    const o = stack.pop()
    suffix += (o === '{' ? '}' : ']')
  }
  return s + suffix
}

function cryptoRandom() {
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('')
}

/* ---------------- streaming sieve ---------------- */
/**
 * Stateful sieve that consumes assistant content deltas and emits:
 *   - text deltas (visible content)
 *   - tool_calls deltas (OpenAI streaming format) when the closing tag
 *     "</|DSML|tool_calls>" is observed
 *
 * Behavior:
 *   - text passes through until "<|DSML|tool_calls>" is seen
 *   - on partial open marker straddling chunks, the partial is held back
 *   - inside a block, all content is buffered until the closing tag
 *   - after the close, the block is parsed and a SINGLE batch of tool_calls
 *     deltas is emitted (each with index/id/type/function)
 *   - subsequent content after the close is dropped (tool calls terminate)
 */
function createSieve() {
  let buffer = ''
  let inside = false
  let blockBuf = ''
  let nextIndex = 0
  let finished = false

  function _maybeOpenStart(s) {
    const idx = s.indexOf(TC_OPEN)
    if (idx >= 0) return { kind: 'full', idx }
    for (let n = TC_OPEN.length - 1; n > 0; n--) {
      if (s.endsWith(TC_OPEN.slice(0, n))) return { kind: 'partial', idx: s.length - n }
    }
    return null
  }

  function _flushBlockIfClosed() {
    const idx = blockBuf.indexOf(TC_CLOSE)
    if (idx < 0) return null
    const inner = blockBuf.slice(0, idx)
    finished = true
    inside = false
    blockBuf = ''
    const wrapped = TC_OPEN + inner + TC_CLOSE
    const calls = parseToolCallsBlock(wrapped)
    if (calls.length === 0) return null
    return calls.map(c => ({
      index: nextIndex++,
      id: c.id,
      type: 'function',
      function: { name: c.function.name, arguments: c.function.arguments }
    }))
  }

  function push(chunk) {
    if (finished) return { textDelta: '', toolCallsDelta: null }
    if (!inside) {
      buffer += chunk
      const hit = _maybeOpenStart(buffer)
      if (!hit) {
        const out = buffer; buffer = ''
        return { textDelta: out, toolCallsDelta: null }
      }
      if (hit.kind === 'partial') {
        const out = buffer.slice(0, hit.idx)
        buffer = buffer.slice(hit.idx)
        return { textDelta: out, toolCallsDelta: null }
      }
      const before = buffer.slice(0, hit.idx)
      blockBuf = buffer.slice(hit.idx + TC_OPEN.length)
      buffer = ''
      inside = true
      const closed = _flushBlockIfClosed()
      return { textDelta: before, toolCallsDelta: closed }
    }
    blockBuf += chunk
    const closed = _flushBlockIfClosed()
    return { textDelta: '', toolCallsDelta: closed }
  }

  function flush() {
    if (finished) return { textDelta: '', toolCallsDelta: null }
    if (!inside && buffer) {
      const out = buffer; buffer = ''
      return { textDelta: out, toolCallsDelta: null }
    }
    if (inside && blockBuf) {
      const wrapped = TC_OPEN + blockBuf + TC_CLOSE
      const calls = parseToolCallsBlock(wrapped)
      if (calls.length > 0) {
        finished = true
        inside = false
        blockBuf = ''
        const deltas = calls.map(c => ({
          index: nextIndex++,
          id: c.id,
          type: 'function',
          function: { name: c.function.name, arguments: c.function.arguments }
        }))
        return { textDelta: '', toolCallsDelta: deltas }
      }
      const out = TC_OPEN + blockBuf
      blockBuf = ''
      inside = false
      return { textDelta: out, toolCallsDelta: null }
    }
    return { textDelta: '', toolCallsDelta: null }
  }

  return { push, flush }
}

module.exports = {
  hasTools,
  buildToolPromptBlock,
  serializeAssistantToolCalls,
  serializeToolResult,
  parseToolCallsFromText,
  createSieve,
  obfuscateToolName,
  deobfuscateToolName,
  _internal: { tryJsonRepair, repairQuotes, balanceBrackets, parseToolCallsBlock }
}
