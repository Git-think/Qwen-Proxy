import { marked } from 'marked'
import hljs from 'highlight.js'

// Configure marked with highlight.js
marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch {
        // fall through
      }
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true,
  gfm: true,
})

// Custom renderer to handle code blocks with our CodeBlock component
const renderer = new marked.Renderer()

renderer.code = function (code, language) {
  const lang = language || 'plaintext'
  let highlighted
  try {
    highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value
  } catch {
    highlighted = escapeHtml(code)
  }
  return `<div class="code-block-wrapper" data-lang="${escapeHtml(lang)}" data-code="${escapeAttr(code)}"><div class="code-block-header"><span class="code-block-lang">${escapeHtml(lang)}</span><button class="code-copy-btn" onclick="window.__copyCode(this)">复制</button></div><pre class="code-block-pre"><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre></div>`
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;')
}

marked.use({ renderer })

// Install global copy handler
if (typeof window !== 'undefined') {
  window.__copyCode = function (btn) {
    const wrapper = btn.closest('.code-block-wrapper')
    const code = wrapper?.getAttribute('data-code') || ''
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = '已复制'
      setTimeout(() => { btn.textContent = '复制' }, 2000)
    })
  }
}

/**
 * Parse markdown content, extracting <think> blocks first
 * Returns { thinking: string|null, content: string }
 */
export function parseMessageContent(raw) {
  if (!raw) return { thinking: null, html: '' }

  // Extract <think>...</think> blocks
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g
  let thinking = null
  const thinkMatches = []

  let match
  while ((match = thinkRegex.exec(raw)) !== null) {
    thinkMatches.push(match[1].trim())
  }

  if (thinkMatches.length > 0) {
    thinking = thinkMatches.join('\n\n')
  }

  // Remove think blocks from content
  const content = raw.replace(thinkRegex, '').trim()
  const html = content ? marked.parse(content) : ''

  return { thinking, html }
}

export function renderMarkdown(text) {
  if (!text) return ''
  return marked.parse(text)
}
