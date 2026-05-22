import React, { useState, useEffect } from 'react'
import { X, Share2, Copy, Check, FileText, Download, Loader2, Code } from 'lucide-react'
import { api } from '../context/AuthContext'

export default function ShareModal({ isOpen, onClose, sessionId, sessionTitle }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedTranscript, setCopiedTranscript] = useState(false)

  // Fetch session messages when modal is opened for sharing
  useEffect(() => {
    if (isOpen && sessionId) {
      setLoading(true)
      setCopiedLink(false)
      setCopiedTranscript(false)
      api.get(`/api/chat/sessions/${sessionId}/messages`)
        .then(response => {
          setMessages(response.data || [])
        })
        .catch(err => {
          console.warn("Failed authenticated fetch, trying public endpoint fallback:", err)
          // Fallback to public endpoint for guests/unauthenticated users
          return api.get(`/api/chat/shared/${sessionId}`)
            .then(response => {
              setMessages(response.data?.messages || [])
            })
            .catch(pubErr => {
              console.error("Failed to load session messages from public endpoint:", pubErr)
            })
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [isOpen, sessionId])

  if (!isOpen) return null

  // Create a clean public-looking shareable link (even though it's local)
  const shareUrl = `${window.location.origin}/share/${sessionId}`

  const fallbackCopy = (text) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed' // avoid scrolling to bottom
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    try {
      document.execCommand('copy')
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch (e) {
      console.error('Fallback copy failed', e)
    }
    document.body.removeChild(textarea)
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch (err) {
      // fallback for insecure contexts (e.g., mobile via IP)
      fallbackCopy(shareUrl)
    }
  }

  const handleCopyTranscript = async () => {
    if (messages.length === 0) return
    const transcript = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Maya'}: ${m.content}`)
      .join('\n\n')

    try {
      await navigator.clipboard.writeText(transcript)
      setCopiedTranscript(true)
      setTimeout(() => setCopiedTranscript(false), 2000)
    } catch (err) {
      // fallback for insecure contexts
      fallbackCopy(transcript)
    }
  }

  const handleExportMarkdown = () => {
    if (messages.length === 0) return
    const title = sessionTitle?.trim() || "Maya Conversation"
    const markdownContent = `# Conversation with Maya: ${title}\n\n` +
      `*Session ID: ${sessionId}*\n` +
      `*Exported on: ${new Date().toLocaleString()}*\n\n` +
      `---\n\n` +
      messages.map(m => `### **${m.role === 'user' ? 'User' : 'Maya'}**\n\n${m.content}`).join('\n\n---\n\n')

    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `maya_chat_${title.replace(/\s+/g, '_')}_${sessionId.slice(0, 8)}.md`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportJSON = () => {
    if (messages.length === 0) return
    const title = sessionTitle?.trim() || "Maya Conversation"
    const exportData = {
      sessionId,
      title,
      exportedAt: new Date().toISOString(),
      messages: messages.map(({ id, role, content, created_at }) => ({ id, role, content, created_at }))
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `maya_chat_${title.replace(/\s+/g, '_')}_${sessionId.slice(0, 8)}.json`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300">
      {/* Backdrop click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Box */}
      <div className="glass-card w-full max-w-md rounded-2xl border border-rose-500/20 p-6 flex flex-col gap-5 relative z-10 text-butter-100 shadow-2xl animate-bubble-entry">
        {/* Top Glow Accent */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-rose-500/10 pb-3">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-butter-50" />
            <span className="text-lg font-bold font-sans tracking-tight text-butter-50">Share Chat</span>
          </div>
          <button 
            onClick={onClose}
            className="text-butter-50 p-1.5 rounded-xl hover:bg-rose-500/10 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5 text-butter-50" />
          </button>
        </div>

        {/* Modal Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-butter-300 gap-3">
            <Loader2 className="w-8 h-8 text-rose-400 animate-spin" />
            <span className="text-sm font-light">Compiling chat moments...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4.5">
            <div className="text-sm text-butter-300 font-light leading-relaxed">
              Share your beautiful conversation moments with Maya or export the chat transcript.
            </div>

            {/* Conversation Details */}
            <div className="bg-wine-900 border border-wine-700 rounded-xl p-3 flex flex-col gap-1">
              <span className="text-xs text-butter-300 font-light">Conversation Title</span>
              <span className="text-sm font-semibold text-butter-50 truncate">
                {sessionTitle?.trim() || "New Conversation"}
              </span>
            </div>

            {/* Link Sharing Panel */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-butter-200 uppercase tracking-wider">Shareable Chat Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 text-sm font-mono font-semibold rounded-xl px-3 py-2.5 bg-wine-900 border border-wine-700 text-butter-50 shadow-sm focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 shrink-0 cursor-pointer ${
                    copiedLink
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                      : 'bg-wine-900 border border-wine-700 text-butter-50 hover:bg-wine-800'
                  }`}
                  title="Copy link to clipboard"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Export & Actions Section */}
            <div className="flex flex-col gap-2 mt-2">
              <label className="text-xs font-semibold text-butter-200 uppercase tracking-wider">Export Transcript</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Copy Text Transcript */}
                <button
                  type="button"
                  onClick={handleCopyTranscript}
                  className={`w-full py-2.5 px-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 text-xs font-medium font-sans cursor-pointer ${
                    copiedTranscript
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                      : 'bg-wine-900 border border-wine-700 text-butter-50 hover:bg-wine-800'
                  }`}
                  title="Copy full conversation text"
                >
                  {copiedTranscript ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Transcript Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-butter-50" />
                      <span>Copy Raw Text</span>
                    </>
                  )}
                </button>

                {/* Export as Markdown */}
                <button
                  onClick={handleExportMarkdown}
                  className="w-full py-2.5 px-4 rounded-xl border border-wine-700 bg-wine-900 text-butter-50 hover:bg-wine-800 transition-all duration-300 flex items-center justify-center gap-2 text-xs font-medium font-sans"
                  title="Download Markdown file"
                >
                  <FileText className="w-4 h-4 text-butter-300" />
                  <span>Download Markdown</span>
                </button>

                {/* Export as JSON */}
                <button
                  onClick={handleExportJSON}
                  className="w-full sm:col-span-2 py-2.5 px-4 rounded-xl border border-wine-700 bg-wine-900 text-butter-50 hover:bg-wine-800 transition-all duration-300 flex items-center justify-center gap-2 text-xs font-medium font-sans"
                  title="Download JSON structured file"
                >
                  <Download className="w-4 h-4 text-butter-50" />
                  <span>Download JSON Logs</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
