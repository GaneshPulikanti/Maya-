import React, { useState, useEffect, useRef } from 'react'
import { useChat } from '../context/ChatContext'
import { Menu, Send, Square, BrainCircuit, Heart, MessageSquare, Copy, Check, X, Loader2, Image, ChevronDown, ChevronLeft, ChevronRight, CornerUpLeft, Volume2, VolumeX, Mic, FileText, File, Paperclip, Share2, Pencil, Trash2, Users } from 'lucide-react'
import ShareModal from './ShareModal'
import FileUpload from './FileUpload'
import VoiceRecorder from './VoiceRecorder'
import VoiceMode from './VoiceMode'
import { api, useAuth } from '../context/AuthContext'

const VocalIcon = ({ isMoving = false, className = "w-5 h-5 text-wine-900" }) => {
  return (
    <div className={`flex items-center justify-center gap-1.5 ${className}`} style={{ minHeight: '20px', minWidth: '20px' }}>
      <span className={`w-1 rounded-full bg-current transition-all duration-300 ${isMoving ? 'animate-vocal-1' : 'h-1.5'}`} style={{ height: !isMoving ? '6px' : undefined, minHeight: '4px' }} />
      <span className={`w-1 rounded-full bg-current transition-all duration-300 ${isMoving ? 'animate-vocal-2' : 'h-3.5'}`} style={{ height: !isMoving ? '14px' : undefined, minHeight: '4px' }} />
      <span className={`w-1 rounded-full bg-current transition-all duration-300 ${isMoving ? 'animate-vocal-3' : 'h-2'}`} style={{ height: !isMoving ? '8px' : undefined, minHeight: '4px' }} />
      <span className={`w-1 rounded-full bg-current transition-all duration-300 ${isMoving ? 'animate-vocal-4' : 'h-1.5'}`} style={{ height: !isMoving ? '6px' : undefined, minHeight: '4px' }} />
    </div>
  )
}

const TypewriterWrapper = ({ messageId, fullText, onComplete, onType, children }) => {
  const [typedText, setTypedText] = useState("");
  const wordsRef = useRef([]);
  const indexRef = useRef(0);

  useEffect(() => {
    const words = fullText.split(/(\s+)/);
    wordsRef.current = words.filter(w => w.length > 0);
    indexRef.current = 0;
    setTypedText("");

    let timer;
    const typeNext = () => {
      if (indexRef.current < wordsRef.current.length) {
        const nextWords = wordsRef.current.slice(0, indexRef.current + 1).join("");
        setTypedText(nextWords);
        indexRef.current += 1;
        if (onType) onType();
        const remaining = wordsRef.current.length - indexRef.current;
        const delay = remaining > 30 ? 10 : 35;
        timer = setTimeout(typeNext, delay);
      } else {
        onComplete();
      }
    };

    timer = setTimeout(typeNext, 30);
    return () => clearTimeout(timer);
  }, [fullText, messageId, onComplete, onType]);

  return children(typedText);
};

export default function ChatWindow({ sidebarOpen, toggleSidebar, toggleDocs }) {
  const {
    activeSessionId,
    setActiveSessionId,
    messages,
    streamingMessage,
    isStreaming,
    loadingMessages,
    sendMessage,
    stopGeneration,
    createSession,
    sessions,
    renameSession,
    voiceEnabled,
    setVoiceEnabled,
    deleteMessage,
    deleteMessagePair,
    editMessage,
    regenerateAfterEdit
  } = useChat()
  const { user } = useAuth()

  const [input, setInput] = useState('')
  const [speakingId, setSpeakingId] = useState(null)

  // Unlock audio context on WebView/mobile platforms
  const unlockAudio = () => {
    if (window._audioUnlocked) return
    try {
      const audio = new Audio()
      audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
      audio.volume = 0
      audio.setAttribute("playsinline", "true")
      document.body.appendChild(audio)
      audio.play().then(() => {
        window._audioUnlocked = true
        console.log("Audio playback unlocked successfully")
        try { document.body.removeChild(audio) } catch (e) {}
      }).catch(err => {
        console.warn("Audio unlock failed:", err)
        try { document.body.removeChild(audio) } catch (e) {}
      })
    } catch (e) {
      console.warn("Audio unlock error:", e)
    }
  }

  const getAvatarColor = (name) => {
    const colors = [
      'bg-rose-600 text-rose-50',
      'bg-indigo-600 text-indigo-50',
      'bg-emerald-600 text-emerald-50',
      'bg-amber-600 text-amber-50',
      'bg-purple-600 text-purple-50',
      'bg-cyan-600 text-cyan-50'
    ]
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  const activeAudioRef = useRef(null)

  const speakMessageText = async (text, msgId) => {
    // If clicking the currently speaking message, stop it
    if (speakingId === msgId) {
      if (activeAudioRef.current) {
        try {
          activeAudioRef.current.pause()
          activeAudioRef.current.src = ''
          if (document.body.contains(activeAudioRef.current)) {
            document.body.removeChild(activeAudioRef.current)
          }
        } catch (e) {}
        activeAudioRef.current = null
      }
      try {
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel()
        }
      } catch (e) {}
      setSpeakingId(null)
      return
    }

    // Stop any active speech first
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause()
        if (document.body.contains(activeAudioRef.current)) {
          document.body.removeChild(activeAudioRef.current)
        }
      } catch (e) {}
      activeAudioRef.current = null
    }
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    } catch (e) {}
    
    // Clean markdown and formatting
    const clean = text
      .replace(/\*+/g, '') // bold/italic
      .replace(/_+/g, '')
      .replace(/`{3}[\s\S]*?`{3}/g, '[Code block]') // hide code blocks
      .replace(/`[^`]+`/g, '') // inline code
      .replace(/#+\s/g, '') // headers
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // links
      .replace(/👥|❤️|✨|😊|💕|🌸|👋/g, '') // remove emojis
      .trim()

    const cleanSliced = clean.slice(0, 160) // Short slice for Orpheus to avoid TPD rate limits

    if (!clean) return

    setSpeakingId(msgId)

    // Pre-create and unlock the audio element synchronously in the click callback gesture context
    const audio = new Audio()
    audio.setAttribute("playsinline", "true")
    audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
    try {
      audio.play().catch(() => {})
    } catch (e) {}
    document.body.appendChild(audio)
    activeAudioRef.current = audio

    const cleanup = () => {
      try {
        if (document.body.contains(audio)) {
          document.body.removeChild(audio)
        }
      } catch (e) {}
      if (activeAudioRef.current === audio) {
        activeAudioRef.current = null
      }
    }

    try {
      const token = localStorage.getItem('token')
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {}
      const res = await api.post(
        '/api/voice/speak',
        { text: cleanSliced, voice: 'diana' },
        { responseType: 'blob', timeout: 12000, headers }
      )

      if (res.status === 200 && res.data?.size > 0 && activeAudioRef.current === audio) {
        const base64Url = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.readAsDataURL(res.data)
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = reject
        })

        audio.onended = () => {
          cleanup()
          setSpeakingId(prev => prev === msgId ? null : prev)
        }

        audio.onerror = (e) => {
          console.warn("Orpheus audio element error:", e)
          cleanup()
          setSpeakingId(prev => prev === msgId ? null : prev)
        }

        audio.src = base64Url
        await audio.play()
      } else {
        cleanup()
        console.warn("Orpheus speak request failed")
        setSpeakingId(prev => prev === msgId ? null : prev)
      }
    } catch (err) {
      console.warn("Orpheus TTS failed:", err)
      cleanup()
      setSpeakingId(prev => prev === msgId ? null : prev)
    }
  }

  const [copiedId, setCopiedId] = useState(null)
  const [pinnedFile, setPinnedFile] = useState(null)
  const [fileUploading, setFileUploading] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      if (input) {
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px'
      }
    }
  }, [input])
  const [voiceModeOpen, setVoiceModeOpen] = useState(false)
  const [shareSession, setShareSession] = useState(null)
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editingText, setEditingText] = useState("")
  const inputRef = useRef(null)

  // Autocomplete states for @ mentions
  const [allFiles, setAllFiles] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(-1)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)

  const fetchAllFiles = async () => {
    try {
      const response = await api.get('/api/upload/documents')
      setAllFiles(response.data)
    } catch (e) {
      console.error("Failed to load documents for autocomplete:", e)
    }
  }

  useEffect(() => {
    fetchAllFiles()
  }, [])

  // ── displayMessages ─────────────────────────────────────────────────────────
  // Builds the list of messages to render, substituting older version Q&A pairs
  // so that only the currently selected version's conversation is visible.
  const displayMessages = React.useMemo(() => {
    const result = []
    const skipIds = new Set()
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (skipIds.has(msg.id)) continue

      if (msg.role === 'user') {
        if (msg.content && msg.content.startsWith('{"versions":')) {
          try {
            const vd = JSON.parse(msg.content)
            const currentIdx = vd.current || 0
            if (currentIdx < vd.versions.length - 1) {
              const pair = vd.versions[currentIdx]
              result.push({ ...msg, content: pair.user, _originalContent: msg.content })
              const nextMsg = messages[i + 1]
              if (nextMsg && nextMsg.role === 'assistant') skipIds.add(nextMsg.id)
              if (pair.assistant) {
                result.push({
                  id: `vhist-${msg.id}-${currentIdx}`,
                  role: 'assistant',
                  content: pair.assistant,
                  created_at: msg.created_at,
                  _isVersionHistory: true
                })
              }
            } else {
              const pair = vd.versions[currentIdx]
              result.push({ ...msg, content: pair.user, _originalContent: msg.content })
            }
          } catch (e) {
            result.push(msg)
          }
        } else {
          result.push(msg)
        }
      } else {
        result.push(msg)
      }
    }
    return result
  }, [messages])

  const copyToClipboard = (text, id) => {
    if (!text) return
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          setCopiedId(id)
          setTimeout(() => setCopiedId(null), 2000)
        })
        .catch((err) => {
          console.error("Clipboard API copy failed, trying fallback:", err)
          fallbackCopy(text, id)
        })
    } else {
      fallbackCopy(text, id)
    }
  }

  const fallbackCopy = (text, id) => {
    const textArea = document.createElement("textarea")
    textArea.value = text
    textArea.style.top = "0"
    textArea.style.left = "0"
    textArea.style.position = "fixed"
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    try {
      document.execCommand('copy')
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Fallback copy failed:', err)
    }
    document.body.removeChild(textArea)
  }

  // ── Version History Helpers ────────────────────────────────────────────────
  // ── Version History Helpers ────────────────────────────────────────────────
  // Returns the current display content for a message (from version history or msg.content)
  const getDisplayContent = (msg) => {
    if (msg.content && msg.content.startsWith('{"versions":')) {
      try {
        const vd = JSON.parse(msg.content)
        return vd.versions[vd.current]?.user || ''
      } catch (e) {}
    }
    return msg.content
  }

  // Navigate between saved version pairs (-1 = back, +1 = forward)
  const navigateVersion = async (msgId, direction) => {
    const msgIndex = messages.findIndex(m => m.id === msgId)
    const originalMsg = messages[msgIndex]
    if (!originalMsg) return

    if (originalMsg.content && originalMsg.content.startsWith('{"versions":')) {
      try {
        const data = JSON.parse(originalMsg.content)
        const newIdx = Math.max(0, Math.min(data.versions.length - 1, data.current + direction))
        if (newIdx !== data.current) {
          const newJsonContent = JSON.stringify({
            ...data,
            current: newIdx
          })
          await editMessage(msgId, newJsonContent)
        }
      } catch (e) {
        console.error("Failed to navigate version:", e)
      }
    }
  }

  const handleSaveEdit = async (msgId, prefix) => {
    if (!editingText.trim()) return
    try {
      const fullText = `${prefix}${editingText.trim()}`

      const msgIndex = messages.findIndex(m => m.id === msgId)
      const originalMsg = messages[msgIndex]
      if (!originalMsg) return

      let versions = []
      
      if (originalMsg.content && originalMsg.content.startsWith('{"versions":')) {
        try {
          const data = JSON.parse(originalMsg.content)
          versions = data.versions || []
        } catch (e) {}
      } else {
        // First edit: seed with original content
        const nextMsg = msgIndex !== -1 ? messages[msgIndex + 1] : null
        const assistantContent = (nextMsg && nextMsg.role === 'assistant') ? nextMsg.content : null
        versions = [{ user: originalMsg.content, assistant: assistantContent }]
      }

      // Add the new edited version
      const newVersions = [...versions, { user: fullText, assistant: null }]
      const newJsonContent = JSON.stringify({
        versions: newVersions,
        current: newVersions.length - 1
      })

      // Persist edit to backend
      const updatedMessage = await editMessage(msgId, newJsonContent)
      
      setEditingMessageId(null)
      setEditingText("")

      // Kick off regeneration
      const newMsgId = updatedMessage?.id || msgId
      regenerateAfterEdit(newMsgId, async (assistantText) => {
        try {
          setMessages(prev => {
            return prev.map(m => {
              if (m.id === newMsgId) {
                try {
                  const data = JSON.parse(m.content)
                  const lastIdx = data.versions.length - 1
                  const updatedPairs = data.versions.map((p, i) =>
                    i === lastIdx ? { ...p, assistant: assistantText } : p
                  )
                  const newJson = JSON.stringify({
                    versions: updatedPairs,
                    current: lastIdx
                  })
                  // Write final content containing assistant response to DB
                  editMessage(newMsgId, newJson).catch(e => console.error("editMessage async fail:", e))
                  return { ...m, content: newJson }
                } catch (e) {
                  return m
                }
              }
              return m
            })
          })
        } catch (e) {
          console.error("Failed to save assistant response in message version:", e)
        }
      })
    } catch (err) {
      alert("Failed to update message: " + (err.message || err))
    }
  }

  const handleDeleteMessage = async (msgId) => {
    const msgIndex = messages.findIndex(m => m.id === msgId)
    const originalMsg = messages[msgIndex]
    if (!originalMsg) return

    if (originalMsg.content && originalMsg.content.startsWith('{"versions":')) {
      try {
        const data = JSON.parse(originalMsg.content)
        if (data.versions.length > 1) {
          if (window.confirm("Delete only this version of the message and its reply?")) {
            const nextMsg = msgIndex !== -1 ? messages[msgIndex + 1] : null
            const assistantMsgId = (nextMsg && nextMsg.role === 'assistant') ? nextMsg.id : null

            const isDeletingActive = (data.current === data.versions.length - 1)
            const updatedPairs = data.versions.filter((_, idx) => idx !== data.current)
            const newCurrent = Math.min(data.current, updatedPairs.length - 1)

            if (isDeletingActive) {
              const newActivePair = updatedPairs[updatedPairs.length - 1]
              const newJsonContent = JSON.stringify({
                versions: updatedPairs,
                current: newCurrent
              })
              await editMessage(msgId, newJsonContent)
              if (assistantMsgId && newActivePair.assistant) {
                await editMessage(assistantMsgId, newActivePair.assistant)
              } else if (assistantMsgId && !newActivePair.assistant) {
                await api.delete(`/api/chat/messages/${assistantMsgId}`)
                setMessages(prev => prev.filter(m => m.id !== assistantMsgId))
              }
            } else {
              const newJsonContent = JSON.stringify({
                versions: updatedPairs,
                current: newCurrent
              })
              await editMessage(msgId, newJsonContent)
            }
          }
          return
        }
      } catch (err) {
        alert("Failed to delete message version: " + (err.message || err))
        return
      }
    }

    if (window.confirm("Delete this message and Maya's reply? This can't be undone.")) {
      try {
        // Find the assistant message that immediately follows this user message
        const nextMsg = msgIndex !== -1 ? messages[msgIndex + 1] : null
        const assistantMsgId = (nextMsg && nextMsg.role === 'assistant') ? nextMsg.id : null
        await deleteMessagePair(msgId, assistantMsgId)
      } catch (err) {
        alert("Failed to delete message: " + (err.message || err))
      }
    }
  }

  const messagesEndRef = useRef(null)
  const viewportRef = useRef(null)
  const isAutoScrollingRef = useRef(true)
  const scrolledForStreamRef = useRef(false)
  const typedMessageIdsRef = useRef(new Set())

  useEffect(() => {
    typedMessageIdsRef.current.clear()
  }, [activeSessionId])

  const [showScrollButton, setShowScrollButton] = useState(false)

  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  const handleScroll = () => {
    const el = viewportRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isAtBottom = distanceFromBottom < 30
    setShowScrollButton(!isAtBottom)
    isAutoScrollingRef.current = isAtBottom
  }

  const shouldScrollOnLoadRef = useRef(false)

  // Track session change to schedule scroll to bottom on load
  useEffect(() => {
    shouldScrollOnLoadRef.current = true
    isAutoScrollingRef.current = true
  }, [activeSessionId])

  const prevMessagesLengthRef = useRef(0)

  // Sync scroll to bottom when messages load or streaming updates
  useEffect(() => {
    const prevLen = prevMessagesLengthRef.current
    prevMessagesLengthRef.current = messages.length

    // 1. If currently streaming
    if (isStreaming) {
      if (!scrolledForStreamRef.current) {
        // Scroll to the bottom so the user's input and the thinking/generation icon are visible
        scrollToBottom('smooth')
        scrolledForStreamRef.current = true
        isAutoScrollingRef.current = false
      }
      // Sync downscroll button, but do not auto-scroll to the bottom while streaming
      handleScroll()
      return
    }

    // 2. When streaming ends, reset the scroll anchor ref
    if (!isStreaming && scrolledForStreamRef.current) {
      scrolledForStreamRef.current = false
    }

    // Detect if a new assistant message arrived via polling (e.g. in group chat)
    if (messages.length > prevLen) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        const targetElement = document.getElementById(`msg-${lastMsg.id}`)
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
          isAutoScrollingRef.current = false
          handleScroll()
          return
        }
      }
    }

    // 3. Regular non-streaming scrolling (such as loading history or normal completion)
    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.role === 'user' && messages.length > prevLen) {
      isAutoScrollingRef.current = true
    }

    if (isAutoScrollingRef.current) {
      scrollToBottom('smooth')
      const timer = setTimeout(() => {
        scrollToBottom('smooth')
        handleScroll() // Sync downscroll button
      }, 60)
      return () => clearTimeout(timer)
    } else {
      handleScroll() // Sync downscroll button
    }
  }, [messages, streamingMessage, isStreaming])

  // Force scroll to bottom once when session messages finish loading
  useEffect(() => {
    if (shouldScrollOnLoadRef.current && !loadingMessages && messages.length > 0) {
      shouldScrollOnLoadRef.current = false
      isAutoScrollingRef.current = true
      scrollToBottom('auto')
      const timer = setTimeout(() => {
        scrollToBottom('auto')
        handleScroll() // Ensure downscroll button is hidden initially when at bottom
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [messages, loadingMessages])

  // Call handleScroll on render changes to ensure button state stays continuously accurate
  useEffect(() => {
    handleScroll()
  }, [messages, loadingMessages, isStreaming, activeSessionId])

  const handleInputChange = (e) => {
    const value = e.target.value
    setInput(value)
    
    // Auto-resize the textarea
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`
    
    const selectionStart = e.target.selectionStart || 0
    const textBeforeCursor = value.slice(0, selectionStart)
    
    // Find the last '@' symbol before the cursor
    const lastAtIdx = textBeforeCursor.lastIndexOf('@')
    
    if (lastAtIdx !== -1) {
      // Check if there are any spaces or newlines between the '@' and the cursor
      const textAfterAt = textBeforeCursor.slice(lastAtIdx + 1)
      const hasSpace = textAfterAt.includes(' ') || textAfterAt.includes('\n')
      
      if (!hasSpace) {
        setMentionIndex(lastAtIdx)
        setMentionFilter(textAfterAt)
        
        const filtered = allFiles.filter(file => 
          file.filename.toLowerCase().includes(textAfterAt.toLowerCase())
        )
        
        if (filtered.length > 0) {
          setSuggestions(filtered)
          setShowSuggestions(true)
          setActiveSuggestionIndex(0)
          return
        }
      }
    }
    
    setShowSuggestions(false)
    setSuggestions([])
  }

  const insertSuggestion = (file) => {
    if (mentionIndex === -1) return
    const value = input
    const textBeforeAt = value.slice(0, mentionIndex)
    const selectionStart = inputRef.current?.selectionStart || value.length
    const textAfterCursor = value.slice(selectionStart)
    
    const insertedText = `@${file.filename} `
    const newValue = textBeforeAt + insertedText + textAfterCursor
    setInput(newValue)
    setShowSuggestions(false)
    setSuggestions([])
    
    setTimeout(() => {
      const newCursorPos = textBeforeAt.length + insertedText.length
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos)
      inputRef.current?.focus()
    }, 20)
  }

  const handleInputKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSuggestionIndex(prev => (prev + 1) % suggestions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertSuggestion(suggestions[activeSuggestionIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setShowSuggestions(false)
        setSuggestions([])
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (window.innerWidth >= 768) {
          e.preventDefault()
          handleSend(e)
        }
      }
    }
  }

  const handleSend = (e) => {
    e.preventDefault()
    unlockAudio()
    if ((!input.trim() && !pinnedFile) || isStreaming || fileUploading) return
    
    let messageText = input.trim()
    
    // Package Reply Context if active
    if (replyToMessage) {
      const cleanReplyText = replyToMessage.content
        .replace(/^\[Reply to:[^\]]*\]\s*/, '')
        .replace(/^\[Look at this image:[^\]]*\]\s*/, '📷 Image ')
        .replace(/^\[Look at this file:[^\]]*\]\s*/, '📄 File ')
        .replace(/\s+/g, ' ')
        .slice(0, 100)
      const senderLabel = replyToMessage.role === 'user' ? 'You' : 'Maya'
      messageText = `[Reply to: ${replyToMessage.id}|${senderLabel}|${cleanReplyText}] ${messageText}`
      setReplyToMessage(null)
    }

    const activeSession = sessions.find(s => s.id === activeSessionId)
    const isGroupChat = activeSession?.title?.toLowerCase().includes("group")
    
    if (isGroupChat && user?.email) {
      const name = user.email.split('@')[0]
      messageText = `[${name}]: ${messageText}`
    }

    if (pinnedFile) {
      const fileUrl = pinnedFile.imageUrl || ''
      if (pinnedFile.fileType === 'image') {
        messageText = `[Look at this image: ${fileUrl}|${pinnedFile.explanation}]${messageText ? ' ' + messageText : ''}`
      } else {
        messageText = `[Look at this file: ${fileUrl}|${pinnedFile.fileName}|${pinnedFile.fileType}|${pinnedFile.explanation}]${messageText ? ' ' + messageText : ''}`
      }
      if (pinnedFile.previewUrl) {
        URL.revokeObjectURL(pinnedFile.previewUrl)
      }
      setPinnedFile(null)
    }
    
    sendMessage(messageText)
    setInput('')
    
    // Focus the input back cleanly in a macro-task macro-timeout to allow DOM settle
    setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
  }

  const renderUserMessageText = (content) => {
    if (!content) return ""
    const match = content.match(/^\[Look at this image: (.*?)\]\s*(.*)$/s)
    if (match) {
      const inner = match[1]
      const userText = match[2]
      
      let imageUrl = null
      let explanation = inner
      
      if (inner.includes('|')) {
        const parts = inner.split('|')
        imageUrl = parts[0]
        explanation = parts.slice(1).join('|')
      }
      
      return (
        <div className="flex flex-col gap-2.5">
          {imageUrl && (
            <div className="relative group max-w-sm rounded-xl overflow-hidden border border-rose-500/20 bg-wine-950/40 shadow-md">
              <img 
                src={imageUrl} 
                alt="Uploaded attachment" 
                className="max-h-60 w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 rounded-lg w-max shrink-0 select-none shadow-sm">
            <Image className="w-3.5 h-3.5 text-rose-300" />
            <span className="font-semibold uppercase tracking-wider text-[10px]">Image Attached</span>
          </div>
          {userText.trim() ? (
            <span>{userText}</span>
          ) : (
            <span className="italic text-butter-300 text-sm">Shared an image</span>
          )}
        </div>
      )
    }

    const fileMatch = content.match(/^\[Look at this file: (.*?)\]\s*(.*)$/s)
    if (fileMatch) {
      const inner = fileMatch[1]
      const userText = fileMatch[2]
      
      let fileUrl = ""
      let fileName = "Attached File"
      let fileType = "other"
      let explanation = inner
      
      if (inner.includes('|')) {
        const parts = inner.split('|')
        fileUrl = parts[0]
        fileName = parts[1] || "Attached File"
        fileType = parts[2] || "other"
        explanation = parts.slice(3).join('|')
      }
      
      // Determine file label
      let typeLabel = "Document"
      if (fileType === 'csv' || fileType === 'xlsx') {
        typeLabel = "Spreadsheet"
      } else if (fileType === 'pptx') {
        typeLabel = "Presentation"
      } else if (fileType === 'pdf') {
        typeLabel = "PDF Document"
      } else if (fileType === 'txt') {
        typeLabel = "Text File"
      }
      
      return (
        <div className="flex flex-col gap-2.5">
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 rounded-xl border border-rose-500/20 hover:border-rose-500/40 bg-wine-950/40 hover:bg-wine-950/60 shadow-md transition-all duration-300 group max-w-sm"
          >
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 group-hover:bg-rose-500/20 group-hover:scale-105 transition-all">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0 pr-2">
              <span className="text-sm font-semibold text-butter-100 truncate group-hover:text-butter-50 transition-colors">
                {fileName}
              </span>
              <span className="text-[10px] text-butter-300 font-light uppercase tracking-wider">
                {typeLabel}
              </span>
            </div>
          </a>
          {userText.trim() ? (
            <span>{userText}</span>
          ) : (
            <span className="italic text-butter-300 text-sm">Shared a document</span>
          )}
        </div>
      )
    }

    return content
  }

  // Parses markdown bold (**bold**), physical actions/gestures (*action*), lists (* item), and filters empty stars cleanly
  const renderMessageText = (text) => {
    if (!text) return ""
    
    // Split into lines to process lists and line breaks beautifully
    const lines = text.split('\n')
    
    return lines.map((line, lineIdx) => {
      let isBullet = false
      let cleanLine = line
      
      // Detect and peel list bullets starting with "* " or "- "
      const trimmed = line.trim()
      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        isBullet = true
        cleanLine = trimmed.replace(/^[\*\-]\s+/, '')
      }
      
      const tokens = []
      let i = 0
      
      while (i < cleanLine.length) {
        // 1. Detect markdown bold: **
        if (cleanLine.substring(i, i + 2) === '**') {
          const nextIdx = cleanLine.indexOf('**', i + 2)
          if (nextIdx !== -1) {
            const boldText = cleanLine.substring(i + 2, nextIdx)
            if (boldText.trim()) {
              tokens.push({ type: 'bold', text: boldText })
            }
            i = nextIdx + 2
          } else {
            // Unmatched **, treat first '*' as text and advance
            tokens.push({ type: 'text', text: '*' })
            i += 1
          }
        } 
        // 2. Detect simulated action/gesture: *
        else if (cleanLine[i] === '*') {
          const nextIdx = cleanLine.indexOf('*', i + 1)
          if (nextIdx !== -1) {
            const actionText = cleanLine.substring(i + 1, nextIdx)
            if (actionText.trim()) {
              tokens.push({ type: 'action', text: actionText })
            }
            i = nextIdx + 1
          } else {
            // Unmatched *, treat as text and advance
            tokens.push({ type: 'text', text: '*' })
            i += 1
          }
        } 
        // 3. Collect standard text characters
        else {
          const nextStar = cleanLine.indexOf('*', i)
          if (nextStar === -1) {
            tokens.push({ type: 'text', text: cleanLine.substring(i) })
            break
          } else {
            tokens.push({ type: 'text', text: cleanLine.substring(i, nextStar) })
            i = nextStar
          }
        }
      }
      
      const renderedTokens = tokens.map((token, tokIdx) => {
        if (token.type === 'bold') {
          return (
            <strong key={tokIdx} className="font-extrabold text-rose-300">
              {token.text}
            </strong>
          )
        }
        if (token.type === 'action') {
          return (
            <span 
              key={tokIdx} 
              className="italic text-rose-300 font-serif font-light block my-1 bg-rose-500/5 px-2.5 py-1 rounded-lg border-l border-rose-500/20"
            >
              *{token.text}*
            </span>
          )
        }
        return <span key={tokIdx}>{token.text}</span>
      })
      
      // Render line as list item or standard spacing container
      if (isBullet) {
        return (
          <div key={lineIdx} className="flex items-start gap-2 ml-4 my-1.5 animate-bubble-entry">
            <span className="text-rose-400 mt-1.5 select-none text-[10px] shrink-0">•</span>
            <span className="flex-1 text-butter-100">{renderedTokens}</span>
          </div>
        )
      }
      
      return (
        <div key={lineIdx} className="min-h-[1.25rem]">
          {renderedTokens}
        </div>
      )
    })
  }




  const [copiedCodeId, setCopiedCodeId] = useState(null)

  const handleCopyCode = (codeText, blockId) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(codeText)
        .then(() => {
          setCopiedCodeId(blockId)
          setTimeout(() => setCopiedCodeId(null), 2000)
        })
        .catch(err => console.error("Failed to copy code:", err))
    }
  }

  // Feature 1: Premium Code Container Block component
  const CodeBlockContainer = ({ language, content, blockId }) => {
    return (
      <div className="w-full my-4 rounded-xl border border-rose-500/20 overflow-hidden bg-wine-950/90 shadow-lg flex flex-col font-sans select-text">
        <div className="h-10 px-4 bg-wine-950/80 border-b border-wine-800/40 flex items-center justify-between text-xs text-rose-300 font-semibold select-none">
          <span className="uppercase tracking-wider font-mono">{language || 'code'}</span>
          <button
            onClick={() => handleCopyCode(content, blockId)}
            className="hover:text-rose-200 transition-colors flex items-center gap-1 active:scale-95 text-butter-300 font-sans border border-transparent"
            type="button"
          >
            {copiedCodeId === blockId ? (
              <span className="text-emerald-400 flex items-center gap-1 font-medium"><Check className="w-3.5 h-3.5" /> Copied!</span>
            ) : (
              <span className="flex items-center gap-1"><Copy className="w-3.5 h-3.5" /> Copy Code</span>
            )}
          </button>
        </div>
        <div className="p-4 overflow-x-auto max-h-[500px]">
          <pre className="font-mono text-xs leading-relaxed text-butter-100 whitespace-pre">{content}</pre>
        </div>
      </div>
    )
  }

  // Feature 2: Dedicated Structured Container Box
  const StructuredContainer = ({ title, content }) => {
    return (
      <div className="w-full my-4 rounded-xl border border-rose-500/10 overflow-hidden bg-wine-950/40 border-l-4 border-l-rose-500 shadow-inner flex flex-col font-sans select-text">
        <div className="h-9 px-4 bg-wine-950/60 border-b border-wine-800/20 flex items-center justify-between text-xs text-rose-300 font-semibold select-none">
          <span className="uppercase tracking-widest">{title}</span>
          <span className="text-[10px] text-butter-300 font-light font-mono">Format Preserved</span>
        </div>
        <div className="p-4 overflow-x-auto max-h-[400px]">
          <pre className="font-mono text-xs leading-relaxed text-butter-200 whitespace-pre">{content}</pre>
        </div>
      </div>
    )
  }

  // Custom parser to split response into text, code, and structured blocks
  const parseAIResponse = (text) => {
    if (!text) return []

    const blocks = []
    const parts = text.split(/```/)

    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx]
      if (idx % 2 === 0) {
        if (!part) continue
        const trimmed = part.trim()
        const isJsonBlock = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
        const isTreeBlock = trimmed.includes('├──') || trimmed.includes('└──') || trimmed.includes('│   ') || trimmed.includes('│──')

        const lines = part.split('\n')
        const isRawCodeBlock = lines.length > 2 && (
          part.includes('const ') || 
          part.includes('import ') || 
          part.includes('function ') || 
          part.includes('class ') || 
          part.includes('def ') || 
          part.includes('public class ') || 
          part.includes('export default ')
        ) && (part.includes('{') || part.includes(':') || part.includes('('))

        if (isJsonBlock) {
          blocks.push({ type: 'structured', language: 'json', content: part })
        } else if (isTreeBlock) {
          blocks.push({ type: 'structured', language: 'tree', content: part })
        } else if (isRawCodeBlock) {
          let lang = 'javascript'
          if (part.includes('def ') || part.includes('import os') || part.includes('print(')) lang = 'python'
          blocks.push({ type: 'code', language: lang, content: part })
        } else {
          blocks.push({ type: 'text', content: part })
        }
      } else {
        const lines = part.split('\n')
        let language = lines[0].trim().toLowerCase()
        let content = lines.slice(1).join('\n')

        const knownLanguages = ['javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx', 'python', 'py', 'html', 'css', 'json', 'yaml', 'bash', 'sh', 'sql', 'cpp', 'c', 'java', 'text', 'diagram', 'tree']
        if (!knownLanguages.includes(language)) {
          content = part
          language = 'text'
        }

        if (language === 'json' || language === 'diagram' || language === 'tree' || content.includes('├──') || content.includes('└──')) {
          blocks.push({ type: 'structured', language: language, content: content })
        } else {
          blocks.push({ type: 'code', language: language, content: content })
        }
      }
    }
    return blocks
  }

  // Feature 3: Reply parser quote rendering
  const renderReplyQuote = (content) => {
    if (!content) return { hasReply: false, cleanContent: "" }
    const match = content.match(/^\[Reply to: (.*?)\|(.*?)\|(.*?)\]\s*(.*)$/s)
    if (match) {
      const originalId = match[1]
      const sender = match[2]
      const snippet = match[3]
      const rest = match[4]
      const prefix = content.slice(0, content.indexOf(rest))

      const scrollToOriginal = (e) => {
        e.stopPropagation()
        const element = document.getElementById(`msg-${originalId}`)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          element.classList.add('bg-rose-500/20', 'scale-[1.02]')
          setTimeout(() => {
            element.classList.remove('bg-rose-500/20', 'scale-[1.02]')
          }, 1500)
        }
      }

      return {
        hasReply: true,
        replyUi: (
          <div 
            onClick={scrollToOriginal}
            className="mb-2 p-2.5 rounded-xl border border-rose-500/20 bg-wine-950/40 border-l-4 border-l-rose-500 text-xs cursor-pointer select-none text-left opacity-80 hover:opacity-100 transition-all duration-300 hover:bg-wine-950/60 shadow-inner max-w-full"
            title="Click to scroll to original message"
          >
            <div className="flex items-center gap-1 font-semibold text-rose-300 text-[10px] uppercase tracking-wider font-sans">
              Replying to {sender}
            </div>
            <div className="text-butter-300 truncate mt-0.5 italic font-sans">
              "{snippet}"
            </div>
          </div>
        ),
        cleanContent: rest,
        prefix: prefix
      }
    }
    return { hasReply: false, cleanContent: content, prefix: "" }
  }

  // Split rendering for Assistant response containing blocks
  const renderAssistantMessage = (msg) => {
    if (!msg.content) {
      return (
        <div className="flex flex-col w-full">
          <div className="px-4 py-3.5 rounded-2xl rounded-tl-none bg-rose-500/5 border border-rose-500/20 flex gap-1.5 items-center shadow-md w-max">
            <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
            <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
            <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
          </div>
        </div>
      )
    }

    const replyData = renderReplyQuote(msg.content)
    const blocks = parseAIResponse(replyData.cleanContent)

    return (
      <div className="flex flex-col gap-2 w-full">
        {replyData.hasReply && replyData.replyUi}
        {blocks.map((block, idx) => {
          if (block.type === 'text') {
            const trimmedText = block.content.trim()
            if (!trimmedText) return null
            return (
              <div 
                key={idx}
                className="px-4 py-3 rounded-2xl rounded-tl-none text-base leading-relaxed font-sans bg-rose-500/5 backdrop-blur-xs border border-rose-500/20 text-butter-100 shadow-md shadow-rose-500/5 w-full"
              >
                {renderMessageText(block.content)}
              </div>
            )
          } else if (block.type === 'code') {
            return (
              <CodeBlockContainer 
                key={idx} 
                language={block.language} 
                content={block.content} 
                blockId={`${msg.id}-code-${idx}`} 
              />
            )
          } else if (block.type === 'structured') {
            let title = "Structured Output"
            if (block.language === 'json') title = "JSON Data Structure"
            if (block.language === 'tree') title = "Folder / Node Hierarchy"
            if (block.language === 'diagram') title = "System Architecture Flow"
            return (
              <StructuredContainer 
                key={idx} 
                title={title} 
                content={block.content} 
              />
            )
          }
          return null
        })}
      </div>
    )
  }

  // Split rendering for User response
  const renderUserMessage = (msg) => {
    // Use version-aware content (current version or original msg.content)
    let displayContent = getDisplayContent(msg)
    
    // Extract and remove name tag
    let tempContent = displayContent;
    const imgPrefix = tempContent.match(/^\[Look at this image:[^\]]*\]\s*/)?.[0] || '';
    tempContent = tempContent.replace(/^\[Look at this image:[^\]]*\]\s*/, '');
    
    const filePrefix = tempContent.match(/^\[Look at this file:[^\]]*\]\s*/)?.[0] || '';
    tempContent = tempContent.replace(/^\[Look at this file:[^\]]*\]\s*/, '');
    
    const replyPrefix = tempContent.match(/^\[Reply to:[^\]]*\]\s*/)?.[0] || '';
    tempContent = tempContent.replace(/^\[Reply to:[^\]]*\]\s*/, '');
    
    const nameMatch = tempContent.match(/^\[(.*?)\]:\s*(.*)$/s);
    if (nameMatch) {
      displayContent = imgPrefix + filePrefix + replyPrefix + nameMatch[2];
    }
    
    const replyData = renderReplyQuote(displayContent)
    const isEditing = editingMessageId === msg.id
    let hasVersions = false
    let vd = null
    const originalContent = msg._originalContent || msg.content
    if (originalContent && originalContent.startsWith('{"versions":')) {
      try {
        vd = JSON.parse(originalContent)
        hasVersions = vd.versions?.length > 1
      } catch (e) {}
    }

    return (
      <div className="flex flex-col gap-1 items-end w-full">
        {replyData.hasReply && replyData.replyUi}
        <div 
          className={`px-4 py-3 rounded-2xl rounded-tr-none text-base leading-relaxed font-sans border shadow-md text-left font-light tracking-wide ${
            isEditing 
              ? 'w-full max-w-lg bg-wine-900/90 border-rose-500/40 p-4 text-butter-100' 
              : 'bg-rose-500 border-rose-600/15 text-white shadow-rose-500/15'
          }`}
        >
          {isEditing ? (
            <div className="flex flex-col gap-3">
              <textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="w-full bg-wine-950/85 border border-rose-500/30 rounded-xl px-3 py-2 text-butter-100 text-sm focus:outline-none focus:border-rose-500/60 font-sans resize-y min-h-[80px] leading-relaxed"
                placeholder="Edit your message..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    handleSaveEdit(msg.id, replyData.prefix || "")
                  }
                  if (e.key === 'Escape') {
                    setEditingMessageId(null)
                    setEditingText("")
                  }
                }}
              />
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-butter-400 font-sans italic select-none">
                  Ctrl+Enter to save · Esc to cancel
                </span>
                <div className="flex gap-2 text-xs font-semibold select-none">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMessageId(null)
                      setEditingText("")
                    }}
                    className="px-3 py-1.5 rounded-lg border border-rose-500/20 bg-wine-950/40 hover:bg-wine-950/60 text-butter-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(msg.id, replyData.prefix || "")}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition-all shadow-[0_0_10px_rgba(158, 2, 50, 0.2)]"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            renderUserMessageText(replyData.cleanContent)
          )}
        </div>

        {/* Version navigation — shown only when message has been edited at least once */}
        {hasVersions && !isEditing && (
          <div className="flex items-center gap-0.5 self-end mt-0.5 select-none">
            <button
              onClick={() => navigateVersion(msg.id, -1)}
              disabled={vd.current === 0}
              className="p-0.5 rounded text-butter-400 hover:text-rose-300 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              title="Previous version"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="text-[10px] text-butter-300 font-medium tabular-nums px-0.5">
              {vd.current + 1}/{vd.versions.length}
            </span>
            <button
              onClick={() => navigateVersion(msg.id, 1)}
              disabled={vd.current === vd.versions.length - 1}
              className="p-0.5 rounded text-butter-400 hover:text-rose-300 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              title="Next version"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
            <span className="text-[10px] text-butter-400/70 italic ml-1 font-sans">Edited</span>
          </div>
        )}
      </div>
    )
  }

  // Derive current emotional state title dynamically
  const getMayaState = () => {
    if (isStreaming && !streamingMessage) return { text: 'Thoughtful', color: 'bg-amber-400' }
    if (isStreaming) return { text: 'Playful', color: 'bg-rose-400' }
    return { text: 'Caring', color: 'bg-emerald-400' }
  }

  const mayaState = getMayaState()

  // Simple clean loader if no active session is selected yet
  if (!activeSessionId) {
    return (
      <div className="flex-1 h-full bg-wine-950 flex flex-col items-center justify-center select-none">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/30 mb-4 animate-emotional-pulse">
          <Heart className="w-8 h-8 text-rose-300 fill-transparent" />
        </div>
        <span className="text-sm font-sans tracking-wide text-butter-300 font-light">
          Entering Maya's Sanctuary...
        </span>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-wine-950/10 overflow-hidden relative">
      
      <header className="h-16 px-4 border-b border-rose-600/10 flex items-center justify-between z-10 bg-rose-500 text-white shadow-md">
        <div className="flex items-center gap-3">
          {/* Hamburger Sidebar Trigger */}
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="text-white hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-all duration-300 mr-1.5 shrink-0"
              title="Expand Sidebar"
            >
              <Menu className="w-5.5 h-5.5" />
            </button>
          )}

          {/* Maya Title */}
          <div 
            onClick={async () => {
              try {
                await createSession("New Conversation")
              } catch (e) {
                alert("Failed to start new chat")
              }
            }}
            className="flex flex-col cursor-pointer select-none hover:text-rose-100 transition-colors duration-300 group"
            title="Start New Chat"
          >
            <span className="text-base font-bold text-white group-hover:text-rose-100 font-sans leading-none transition-colors duration-300">Maya</span>
            <span className="text-xs text-white/85 font-light mt-1.5 flex items-center gap-1 leading-none">
              <span>Companion</span>
              <span className="text-[10px]">•</span>
              <span className="italic">{mayaState.text}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Voice Assistant Toggle */}
          <button
            onClick={() => {
              unlockAudio()
              setVoiceEnabled(prev => {
                const nextVal = !prev
                if (!nextVal && window.speechSynthesis) {
                  window.speechSynthesis.cancel()
                  setSpeakingId(null)
                }
                return nextVal
              })
            }}
            className={`p-2 rounded-xl transition-all duration-300 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider font-sans border ${
              voiceEnabled
                ? 'bg-white/15 border-white/25 text-wine-900 shadow-sm hover:bg-white/20 drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]'
                : 'border-transparent text-wine-900 hover:text-white hover:bg-white/10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]'
            }`}
            title={voiceEnabled ? "Voice ON — Maya speaks her replies. Click to mute." : "Voice OFF — Click to enable Maya's voice"}
          >
            {voiceEnabled ? (
              <>
                <Volume2 className="w-4 h-4 animate-pulse" />
                <span className="hidden sm:inline">Voice On</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4" />
                <span className="hidden sm:inline">Voice Off</span>
              </>
            )}
          </button>

          {/* Share Active Chat Button */}
          {activeSessionId && (
            <button
              onClick={() => setShareSession({ id: activeSessionId, title: sessions.find(s => s.id === activeSessionId)?.title })}
              className="text-wine-900 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-all duration-300 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider font-sans border border-transparent"
              title="Share this active conversation"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Share</span>
            </button>
          )}

          {/* Start Group Chat Button */}
          <button
            onClick={async () => {
              try {
                const newSess = await createSession("Group Chat Room")
                setShareSession({ id: newSess.id, title: newSess.title })
              } catch (e) {
                alert("Failed to start group chat: " + e.message)
              }
            }}
            className="text-wine-900 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-all duration-300 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider font-sans border border-transparent"
            title="Start a group chat where multiple users can chat with the shared link together"
          >
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">Group Chat</span>
          </button>

          {/* Brain Hub Trigger (RAG/Memory) */}
          <button
            onClick={toggleDocs}
            className="text-wine-900 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-all duration-300 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider font-sans border border-transparent drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
            title="Open Maya's Mind"
          >
            <BrainCircuit className="w-4 h-4" />
            <span className="hidden sm:inline">Her Mind</span>
          </button>
        </div>
      </header>

      {/* Viewport Wrapper */}
      <div className="flex-1 min-h-0 relative">
        {/* Message Viewport */}
        <div
          ref={viewportRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-6 space-y-6 flex flex-col"
        >
          {loadingMessages && messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-butter-300">
              <div className="flex gap-2 items-center mb-3">
                <span className="w-3.5 h-3.5 rounded-full bg-rose-400 typing-dot" />
                <span className="w-3.5 h-3.5 rounded-full bg-rose-400 typing-dot" />
                <span className="w-3.5 h-3.5 rounded-full bg-rose-400 typing-dot" />
              </div>
              <span className="text-xs font-sans tracking-widest uppercase font-semibold text-rose-300/80 animate-pulse">
                Retrieving conversation...
              </span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 select-none animate-bubble-entry">
              <div className="w-20 h-20 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20 mb-4 animate-emotional-pulse shadow-lg shadow-rose-500/5">
                <Heart className="w-10 h-10 text-rose-300 fill-transparent" />
              </div>
              <span className="text-xl lg:text-2xl text-butter-200 font-light italic tracking-wide max-w-md">
                Say hello to Maya... She is waiting for you.
              </span>
            </div>
          ) : (
            displayMessages.map((msg) => {
              const isUser = msg.role === 'user'
              let displayName = isUser ? 'User' : 'Maya'

              // Parse custom guest names or fallback to user profile
              if (isUser) {
                let tempContent = getDisplayContent(msg);
                tempContent = tempContent.replace(/^\[Look at this image:[^\]]*\]\s*/, '');
                tempContent = tempContent.replace(/^\[Look at this file:[^\]]*\]\s*/, '');
                tempContent = tempContent.replace(/^\[Reply to:[^\]]*\]\s*/, '');
                
                const nameMatch = tempContent.match(/^\[(.*?)\]:\s*(.*)$/s);
                const currentSession = sessions.find(s => s.id === activeSessionId)
                const isOwner = currentSession?.user_id === user?.id
                
                if (nameMatch) {
                  displayName = nameMatch[1]
                } else {
                  if (isOwner) {
                    displayName = user?.email ? user.email.split('@')[0] : 'User'
                  } else {
                    displayName = 'Host'
                  }
                }

                // If this is the current user's message, display 'YOU'
                const isMe = user?.email && (
                  displayName.toLowerCase() === user.email.toLowerCase() ||
                  displayName.toLowerCase() === user.email.split('@')[0].toLowerCase()
                )
                if (isMe) {
                  displayName = 'YOU'
                }
              }

              return (
                <div
                  key={msg.client_id || msg.id}
                  id={`msg-${msg.id}`}
                  className={`flex flex-col w-full md:max-w-[85%] lg:max-w-[75%] transition-all duration-300 rounded-2xl ${msg.isLocal ? 'animate-bubble-entry' : ''} ${
                    isUser 
                      ? 'self-end items-end' 
                      : 'self-start items-start'
                  }`}
                >
                  {/* Bubble Content Wrapper */}
                  <div className="w-full">
                    {(() => {
                      const isMsgNew = !isUser && msg.role === 'assistant' && !msg.isLocal && msg.id && !msg.id.toString().startsWith('vhist-') && !typedMessageIdsRef.current.has(msg.id) && (new Date() - new Date(msg.created_at) < 15000);
                      if (isMsgNew) {
                        return (
                          <TypewriterWrapper
                            messageId={msg.id}
                            fullText={msg.content}
                            onComplete={() => {
                              typedMessageIdsRef.current.add(msg.id)
                            }}
                            onType={() => {
                              if (isAutoScrollingRef.current) {
                                scrollToBottom('smooth')
                              }
                            }}
                          >
                            {(typedContent) => renderAssistantMessage({ ...msg, content: typedContent })}
                          </TypewriterWrapper>
                        )
                      }
                      return isUser ? renderUserMessage(msg) : renderAssistantMessage(msg);
                    })()}
                  </div>
                  
                  <span className={`text-[10px] text-butter-300 font-light mt-1.5 font-sans flex items-center gap-1.5 select-none w-full ${isUser ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
                    <span className="truncate max-w-[100px] sm:max-w-[150px] block" title={isUser ? displayName : 'Maya'}>
                      {isUser ? displayName : 'Maya'}
                    </span>
                    <span className="text-[8px] shrink-0">•</span>
                    <button
                      onClick={() => {
                        const content = getDisplayContent(msg)
                        const clean = content.replace(/^\[Reply to:[^\]]*\]\s*/, '').replace(/^\[Look at this file:[^\]]*\]\s*/, '').replace(/^\[Look at this image:[^\]]*\]\s*/, '')
                        copyToClipboard(clean, msg.id)
                      }}
                      className="hover:text-rose-300 transition-colors flex items-center gap-0.5 active:scale-95"
                      title="Copy message text"
                    >
                      {copiedId === msg.id ? (
                        <span className="text-emerald-400 flex items-center gap-0.5 font-medium"><Check className="w-3 h-3" /> Copied!</span>
                      ) : (
                        <span className="flex items-center gap-0.5 opacity-80 hover:opacity-100"><Copy className="w-3 h-3" /> Copy</span>
                      )}
                    </button>
                    
                    {/* Speech Synthesis Playback */}
                    <span className="text-[8px]">•</span>
                    <button
                      onClick={() => {
                        const content = getDisplayContent(msg)
                        const clean = content.replace(/^\[Reply to:[^\]]*\]\s*/, '').replace(/^\[Look at this file:[^\]]*\]\s*/, '').replace(/^\[Look at this image:[^\]]*\]\s*/, '')
                        speakMessageText(clean, msg.id)
                      }}
                      className={`hover:text-rose-300 transition-colors flex items-center gap-0.5 active:scale-95 ${
                        speakingId === msg.id ? 'text-rose-300 font-medium' : ''
                      }`}
                      title={speakingId === msg.id ? "Stop reading" : "Read aloud"}
                    >
                      {speakingId === msg.id ? (
                        <span className="flex items-center gap-0.5 opacity-100"><VolumeX className="w-3 h-3 text-rose-400" /> Stop</span>
                      ) : (
                        <span className="flex items-center gap-0.5 opacity-80 hover:opacity-100"><Volume2 className="w-3 h-3" /> Speak</span>
                      )}
                    </button>

                    <span className="text-[8px]">•</span>
                    <button
                      onClick={() => setReplyToMessage({ id: msg.id, role: msg.role, content: msg.content })}
                      className="hover:text-rose-300 transition-colors flex items-center gap-0.5 active:scale-95"
                      title="Reply to this message"
                    >
                      <CornerUpLeft className="w-3 h-3" />
                      <span className="opacity-80 hover:opacity-100">Reply</span>
                    </button>
                    {isUser && (
                      <>
                        <span className="text-[8px]">•</span>
                        <button
                          onClick={() => {
                            const currentContent = getDisplayContent(msg)
                            const replyData = renderReplyQuote(currentContent)
                            setEditingMessageId(msg.id)
                            setEditingText(replyData.cleanContent)
                          }}
                          className="hover:text-amber-300 transition-colors flex items-center gap-0.5 active:scale-95"
                          title="Edit this message"
                        >
                          <Pencil className="w-3 h-3" />
                          <span className="opacity-80 hover:opacity-100">Edit</span>
                        </button>
                        <span className="text-[8px]">•</span>
                        <button
                          onClick={() => handleDeleteMessage(msg.id)}
                          className="hover:text-red-400 transition-colors flex items-center gap-0.5 active:scale-95"
                          title="Delete this message"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span className="opacity-80 hover:opacity-100">Delete</span>
                        </button>
                      </>
                    )}
                  </span>
                </div>
              )
            })
          )}

          {/* Global Typing Indicator for Group Chat Sync */}
          {displayMessages.length > 0 && displayMessages[displayMessages.length - 1].role === 'user' && (
            <div className="flex flex-col w-full md:max-w-[85%] lg:max-w-[75%] transition-all duration-300 rounded-2xl self-start items-start animate-bubble-entry">
              <div className="w-full">
                <div className="flex flex-col w-full">
                  <div className="px-4 py-3.5 rounded-2xl rounded-tl-none bg-rose-500/5 border border-rose-500/20 flex gap-1.5 items-center shadow-md w-max">
                    <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
                    <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
                    <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
                  </div>
                </div>
              </div>
              <span className="text-[10px] text-butter-300 font-light mt-1.5 font-sans flex items-center gap-1.5 select-none w-full justify-start pl-1">
                <span className="block">Maya</span>
              </span>
            </div>
          )}



          <div ref={messagesEndRef} />
        </div>

        {/* Floating Scroll to Bottom Down Arrow Button (compact) */}
        <button
          type="button"
          onClick={() => {
            isAutoScrollingRef.current = true
            scrollToBottom('smooth')
            setShowScrollButton(false)
          }}
          className={`absolute bottom-6 right-6 p-3 rounded-full text-white shadow-md z-30 flex items-center justify-center bg-rose-500 ${
            showScrollButton ? 'block' : 'hidden'
          }`}
          title="Scroll to bottom"
        >
          <ChevronDown className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Input Panel */}
      <div className="p-4 border-t border-wine-800/40 bg-wine-900/30 backdrop-blur-md">
        
        {/* Pinned File Preview / Uploading State */}
        {(pinnedFile || fileUploading) && (
          <div className="mb-3 p-2 rounded-xl bg-wine-900/80 border border-rose-500/25 backdrop-blur-md flex items-center justify-between animate-bubble-entry">
            <div className="flex items-center gap-3">
              {fileUploading ? (
                <div className="w-12 h-12 rounded-lg bg-rose-500/5 border border-rose-500/20 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-rose-300" />
                </div>
              ) : pinnedFile.fileType === 'image' ? (
                <img
                  src={pinnedFile.previewUrl}
                  alt="Pinned"
                  className="w-12 h-12 rounded-lg object-cover border border-rose-500/30"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-300">
                  <FileText className="w-6 h-6" />
                </div>
              )}
              <div className="flex flex-col select-none">
                <span className="text-xs font-semibold text-butter-100">
                  {fileUploading ? "Analyzing file..." : pinnedFile.fileName || "Pinned File"}
                </span>
                <span className="text-[10px] text-butter-300 font-light">
                  {fileUploading ? "Extracting context..." : "Ready to send with your message"}
                </span>
              </div>
            </div>
            {!fileUploading && (
              <button
                type="button"
                onClick={() => {
                  if (pinnedFile?.previewUrl) {
                    URL.revokeObjectURL(pinnedFile.previewUrl)
                  }
                  setPinnedFile(null)
                }}
                className="p-1.5 rounded-lg hover:bg-rose-500/10 text-butter-300 hover:text-rose-300 transition-colors active:scale-95"
                title="Remove pinned file"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Feature 3: Reply to message preview above input box */}
        {replyToMessage && (
          <div className="mb-3 p-3 rounded-xl bg-wine-950/80 border-l-4 border-rose-500 flex items-center justify-between animate-bubble-entry select-none shadow-md">
            <div className="flex flex-col min-w-0 pr-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1 font-sans">
                <CornerUpLeft className="w-3 h-3" /> Replying to {replyToMessage.role === 'user' ? 'You' : 'Maya'}
              </span>
              <p className="text-xs text-butter-200 font-light truncate mt-0.5 font-sans">
                {replyToMessage.content.replace(/^\[Reply to:[^\]]*\]\s*/, '').replace(/^\[Look at this image:[^\]]*\]\s*/, '📷 Image ').replace(/^\[Look at this file:[^\]]*\]\s*/, '📄 File ').slice(0, 100)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplyToMessage(null)}
              className="p-1 rounded-lg hover:bg-rose-500/10 text-butter-300 hover:text-rose-300 transition-colors shrink-0"
              title="Cancel reply"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Autocomplete Suggestions Popup Overlay */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute bottom-[72px] left-4 right-4 z-50 max-h-48 overflow-y-auto bg-wine-900/95 backdrop-blur-md border border-rose-500/30 rounded-xl shadow-2xl p-1.5 space-y-0.5 animate-bubble-entry">
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rose-300 font-sans border-b border-wine-800/40 mb-1 flex items-center justify-between">
              <span>Target Mind Files</span>
              <span className="text-[8px] text-butter-300 font-mono">Use ↑↓ and Enter</span>
            </div>
            {suggestions.map((file, idx) => {
              const ext = file.filename.split('.').pop().toLowerCase()
              const isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)
              return (
                <div
                  key={file.id}
                  onClick={() => insertSuggestion(file)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 select-none ${
                    idx === activeSuggestionIndex 
                      ? 'bg-rose-500/15 border-l-4 border-l-rose-500 text-rose-300 shadow-sm shadow-rose-500/5' 
                      : 'text-butter-100 hover:bg-wine-800/60 hover:text-butter-50'
                  }`}
                >
                  {isImg ? (
                    <Image className="w-4 h-4 text-rose-300 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-rose-300 shrink-0" />
                  )}
                  <span className="text-sm font-sans font-medium truncate flex-1">{file.filename}</span>
                </div>
              )
            })}
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2 items-center">
          <FileUpload
            onUploadStart={() => setFileUploading(true)}
            onUploadComplete={(data) => {
              setPinnedFile(data)
              setFileUploading(false)
            }}
            onUploadError={() => setFileUploading(false)}
            disabled={isStreaming || fileUploading}
          />
          <VoiceRecorder
            onTranscriptionComplete={(transcription) => {
              setInput(prev => prev ? prev + ' ' + transcription : transcription)
            }}
            disabled={isStreaming || fileUploading}
          />
          <div className="flex-1 min-w-0 rounded-xl rose-input overflow-hidden flex bg-transparent">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onFocus={fetchAllFiles}
              placeholder={isStreaming ? "Maya is responding..." : "Open your heart..."}
              rows={1}
              style={{ maxHeight: '150px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              className="w-full px-3 py-3 sm:px-4 font-sans text-sm sm:text-base focus:outline-none resize-none bg-transparent border-none text-butter-100"
            />
          </div>

          {/* Stop button while streaming, Send button otherwise */}
          {isStreaming ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="p-2 sm:p-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition-all duration-200 shrink-0 flex items-center justify-center gap-1.5 shadow-lg shadow-rose-600/30 animate-pulse hover:animate-none hover:scale-105 active:scale-95 border border-rose-400/30"
              title="Stop generation"
            >
              <Square className="w-4 h-4 sm:w-4.5 sm:h-4.5 fill-white" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={(!input.trim() && !pinnedFile) || fileUploading}
              className="p-2 sm:p-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-butter-50 transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none hover:shadow-lg hover:shadow-rose-500/25 shrink-0 flex items-center justify-center"
            >
              <Send className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-wine-900" />
            </button>
          )}

          {/* Live Voice Chat button placed to the right of Send button */}
          <div
            className={`transition-all duration-300 ease-in-out overflow-hidden flex items-center justify-center shrink-0 ${
              input.trim() ? 'max-w-0 opacity-0 -ml-2' : 'max-w-[50px] opacity-100 ml-0'
            }`}
          >
            <button
              type="button"
              onClick={() => setVoiceModeOpen(true)}
              className="p-2 sm:p-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-wine-900 shadow-md hover:scale-105 active:scale-95 transition-all duration-200 shrink-0 flex items-center justify-center border border-rose-400/20"
              title="Start live voice conversation with Maya"
            >
              <VocalIcon className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-wine-900" isMoving={false} />
            </button>
          </div>
        </form>
      </div>

      {/* Voice Conversation Mode Overlay */}
      <VoiceMode
        isOpen={voiceModeOpen}
        onClose={() => setVoiceModeOpen(false)}
      />

      {/* Share Modal Dialog */}
      <ShareModal
        isOpen={shareSession !== null}
        onClose={() => setShareSession(null)}
        sessionId={shareSession?.id}
        sessionTitle={shareSession?.title}
      />

    </div>
  )
}
