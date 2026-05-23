import React, { useState, useEffect, useRef } from 'react'
import { Heart, MessageSquare, Copy, Check, ChevronLeft, ArrowRight, Loader2, Send, Volume2, VolumeX, Download } from 'lucide-react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'
import ShareModal from './ShareModal'

// API base client setup matching AuthContext
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: {
    'Content-Type': 'application/json'
  }
})

export default function SharedChatView({ sessionId, onBackToApp }) {
  const { user } = useAuth()
  let chatContext = null
  try {
    chatContext = useChat()
  } catch (e) {
    // Silent catch if rendered outside ChatProvider (unauthenticated guests)
  }

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [isCloning, setIsCloning] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)

  // Collaborative chat states
  const [input, setInput] = useState("")
  const [guestName, setGuestName] = useState(() => {
    return localStorage.getItem('group_chat_guest_name') || "Guest"
  })
  const [sending, setSending] = useState(false)
  const [streamingMessage, setStreamingMessage] = useState(null)
  const [speakingId, setSpeakingId] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      if (input) {
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px'
      }
    }
  }, [input])

  const getAvatarColor = (name) => {
    const colors = [
      'bg-rose-600 text-rose-50',
      'bg-indigo-600 text-indigo-50',
      'bg-emerald-600 text-emerald-50',
      'bg-amber-600 text-amber-50',
      'bg-purple-600 text-purple-50',
      'bg-cyan-600 text-cyan-50'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  const speakMessageText = (text, msgId) => {
    if (!window.speechSynthesis) return
    
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel()
      if (speakingId === msgId) {
        setSpeakingId(null)
        return
      }
    }
    
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
      .slice(0, 400);

    const utterance = new SpeechSynthesisUtterance(clean)
    utterance.rate = 1.0
    utterance.pitch = 1.05
    utterance.volume = 1.0
    
    utterance.onend = () => setSpeakingId(null)
    utterance.onerror = () => setSpeakingId(null)

    // Choose premium female voice
    const voices = window.speechSynthesis.getVoices()
    const femaleVoice = voices.find(v => 
      ['Samantha', 'Victoria', 'Karen', 'Moira', 'Tessa', 'Google US English', 'Hazel', 'Zira', 'Fiona', 'Veena'].some(name => 
        v.name.includes(name)
      )
    ) || voices.find(v => v.lang.includes('en') && v.name.toLowerCase().includes('female'))
    if (femaleVoice) utterance.voice = femaleVoice

    setSpeakingId(msgId)
    window.speechSynthesis.speak(utterance)
  }

  // 1. Setup continuous polling every 1 second to fetch latest messages for group collaboration (faster sync)
  useEffect(() => {
    if (!sessionId) return

    const fetchHistory = () => {
      api.get(`/api/chat/shared/${sessionId}`)
        .then(response => {
          setSession(prev => {
            if (!prev) return response.data;
            const msgs = response.data.messages;
            const merged = msgs.map((serverMsg, idx) => {
              const prevMsg = prev.messages[idx];
              if (prevMsg && prevMsg.role === serverMsg.role && prevMsg.client_id) {
                return { ...serverMsg, client_id: prevMsg.client_id };
              }
              return serverMsg;
            });
            return { ...response.data, messages: merged };
          })
          setError(null)
        })
        .catch(err => {
          console.error("Failed to load shared conversation:", err)
          // Only show error on first load
          if (loading) {
            setError(err.response?.data?.detail || "This shared conversation could not be loaded or is no longer available.")
          }
        })
        .finally(() => {
          setLoading(false)
        })
    }

    // Initial fetch
    fetchHistory()

    const intervalId = setInterval(fetchHistory, 1000)
    return () => clearInterval(intervalId)
  }, [sessionId])

  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  const scrolledForStreamRef = useRef(false)

  // Only auto-scroll if user is actively in conversation (has sent messages), not on initial load
  useEffect(() => {
    // Don't auto-scroll on initial page load; user should see title first
    if (sending) {
      if (!scrolledForStreamRef.current) {
        scrollToBottom('smooth')
        scrolledForStreamRef.current = true
      }
    } else {
      scrolledForStreamRef.current = false
    }
  }, [sending])

  const copyMessageText = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error("Failed to copy message:", err)
    }
  }

  // Simple formatter to parse raw message text with line breaks
  const formatText = (text) => {
    if (!text) return ""
    return text.split('\n').map((line, idx) => (
      <span key={idx} className="block min-h-[1rem]">
        {line}
      </span>
    ))
  }

  const handleContinueClick = async () => {
    if (user) {
      setIsCloning(true)
      try {
        if (isGroupChat && chatContext?.joinSession) {
          await chatContext.joinSession(sessionId)
        } else if (chatContext?.cloneSession) {
          await chatContext.cloneSession(sessionId)
        }
      } catch (err) {
        alert(`Failed to ${isGroupChat ? 'join' : 'clone'} conversation: ` + (err.message || err))
      } finally {
        setIsCloning(false)
      }
    } else {
      // Guest: save sessionId and redirect to login
      sessionStorage.setItem(isGroupChat ? 'join_shared_session_id' : 'continue_shared_session_id', sessionId)
      onBackToApp()
    }
  }

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || sending) return

    const userText = input.trim()
    const formattedContent = `[${guestName}]: ${userText}`
    
    // Add optimistic user message locally
    const tempUserMsg = {
      id: `local-usr-${Date.now()}`,
      client_id: `local-usr-${Date.now()}`,
      role: 'user',
      content: formattedContent,
      created_at: new Date().toISOString(),
      isLocal: true
    }
    
    const assistantMessageId = `local-ast-${Date.now()}`
    const initialAssistantMessage = {
      id: assistantMessageId,
      client_id: assistantMessageId,
      role: 'assistant',
      content: "",
      created_at: new Date().toISOString(),
      isLocal: true
    }

    setSession(prev => ({
      ...prev,
      messages: [...(prev?.messages || []), tempUserMsg, initialAssistantMessage]
    }))
    setInput("")
    setSending(true)
    setStreamingMessage("")

    try {
      // Post to public shared message sending endpoint
      const baseUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:10000"
      const response = await fetch(`${baseUrl}/api/chat/shared/${sessionId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: formattedContent })
      })

      if (!response.ok) {
        throw new Error('Failed to send message to group session.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let partialChunk = ""
      let fullAssistantText = ""

      const tokenQueue = []
      let isReadingFinished = false

      // Artificial typewriter effect loop
      const renderPromise = (async () => {
        while (!isReadingFinished || tokenQueue.length > 0) {
          if (tokenQueue.length > 0) {
            const token = tokenQueue.shift()
            fullAssistantText += token
            setStreamingMessage(fullAssistantText)
            
            setSession(prev => ({
              ...prev,
              messages: prev.messages.map(m => 
                m.id === assistantMessageId ? { ...m, content: fullAssistantText, isLocal: true } : m
              )
            }))
            
            // Speed up if the queue gets too large so it doesn't lag too far behind
            const delay = tokenQueue.length > 20 ? 5 : 20
            await new Promise(r => setTimeout(r, delay))
          } else {
            await new Promise(r => setTimeout(r, 10))
          }
        }
      })()

      try {
        while (true) {
          const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = (partialChunk + chunk).split('\n')
        partialChunk = lines.pop() || ""

        for (const line of lines) {
          const cleanedLine = line.trim()
          if (!cleanedLine) continue
          if (cleanedLine.startsWith('data: ')) {
            const dataStr = cleanedLine.slice(6)
            if (dataStr === '[DONE]') break
            try {
              const parsed = JSON.parse(dataStr)
              if (parsed.token) {
                tokenQueue.push(parsed.token)
              }
            } catch (e) {
              console.warn("Could not parse token in stream:", e)
            }
          }
        }
      }
      } finally {
        isReadingFinished = true
        await renderPromise
      }

      // Fetch immediately to sync DB state
      const syncRes = await api.get(`/api/chat/shared/${sessionId}`)
      setSession(syncRes.data)
    } catch (err) {
      console.error("Shared chat message send failed:", err)
      alert("Error sending message: " + err.message)
    } finally {
      setSending(false)
      setStreamingMessage(null)
    }
  }

  const renderMessage = (msg) => {
    if (msg.role === 'assistant' && !msg.content) {
      return (
        <div key={msg.id} className="flex flex-col self-start items-start w-full">
          <div className="px-4 py-3.5 rounded-2xl rounded-tl-none bg-rose-500/5 border border-rose-500/20 flex gap-1.5 items-center shadow-md animate-bubble-entry">
            <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
            <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
            <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
          </div>
        </div>
      )
    }

    const isUser = msg.role === 'user'
    let displayName = isUser ? 'User' : 'Maya'
    let cleanContent = msg.content

    if (isUser) {
      let tempContent = msg.content;
      const imgPrefix = tempContent.match(/^\[Look at this image:[^\]]*\]\s*/)?.[0] || '';
      tempContent = tempContent.replace(/^\[Look at this image:[^\]]*\]\s*/, '');
      
      const filePrefix = tempContent.match(/^\[Look at this file:[^\]]*\]\s*/)?.[0] || '';
      tempContent = tempContent.replace(/^\[Look at this file:[^\]]*\]\s*/, '');
      
      const replyPrefix = tempContent.match(/^\[Reply to:[^\]]*\]\s*/)?.[0] || '';
      tempContent = tempContent.replace(/^\[Reply to:[^\]]*\]\s*/, '');
      
      const nameMatch = tempContent.match(/^\[(.*?)\]:\s*(.*)$/s);
      if (nameMatch) {
        displayName = nameMatch[1]
        cleanContent = imgPrefix + filePrefix + replyPrefix + nameMatch[2]
      }

      const isMe = (displayName === guestName || (user?.email && (
        displayName.toLowerCase() === user.email.toLowerCase() ||
        displayName.toLowerCase() === user.email.split('@')[0].toLowerCase()
      )))
      if (isMe) {
        displayName = 'YOU'
      }
    }

    return (
      <div
        key={msg.client_id || msg.id}
        className={`flex flex-col max-w-[85%] transition-all duration-300 rounded-2xl ${msg.isLocal ? 'animate-bubble-entry' : ''} ${
          isUser ? 'self-end items-end w-full' : 'self-start items-start w-full'
        }`}
      >
        {/* Bubble content */}
        <div className="w-full flex flex-col min-w-0">
          <div
            className={`px-4 py-3 rounded-2xl text-base leading-relaxed font-sans shadow-md text-left w-full ${
              isUser
                ? 'bg-wine-900 border border-rose-500/10 text-butter-100 rounded-tr-none font-light tracking-wide'
                : 'bg-rose-500/5 backdrop-blur-xs border border-rose-500/20 text-butter-100 rounded-tl-none shadow-rose-500/5'
            }`}
          >
            {/* Display custom sender name tag inside bubble */}
            <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 select-none ${isUser ? 'text-rose-300' : 'text-rose-400'}`}>
              {displayName}
            </div>
            {formatText(cleanContent)}
          </div>
        </div>

        <span className={`text-[10px] text-butter-300 font-light mt-1.5 font-sans flex items-center gap-1.5 select-none w-full ${isUser ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
          <span className="truncate max-w-[100px] sm:max-w-[150px] block" title={isUser ? displayName : 'Maya'}>
            {isUser ? displayName : 'Maya'}
          </span>
          <span className="text-[8px] shrink-0">•</span>
          <button
            onClick={() => copyMessageText(cleanContent, msg.id)}
            className="hover:text-rose-300 transition-colors flex items-center gap-0.5 active:scale-95"
            title="Copy text"
          >
            {copiedId === msg.id ? (
              <span className="text-emerald-400 flex items-center gap-0.5 font-medium">
                <Check className="w-3 h-3" /> Copied!
              </span>
            ) : (
              <span className="flex items-center gap-0.5 opacity-80 hover:opacity-100">
                <Copy className="w-3 h-3" /> Copy
              </span>
            )}
          </button>
          <span className="text-[8px]">•</span>
          <button
            onClick={() => speakMessageText(cleanContent, msg.id)}
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
        </span>
      </div>
    )
  }

  if (isCloning) {
    return (
      <div className="h-full w-full bg-wine-950 flex flex-col items-center justify-center select-none text-butter-300 gap-4">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/30 animate-emotional-pulse">
          <Heart className="w-8 h-8 text-rose-300 fill-transparent" />
        </div>
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />
          <span className="text-sm font-sans tracking-wide font-light">
            Cloning conversation history into your sanctuary...
          </span>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full w-full bg-wine-950 flex flex-col items-center justify-center select-none text-butter-300 gap-4">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/30 animate-emotional-pulse">
          <Heart className="w-8 h-8 text-rose-300 fill-transparent" />
        </div>
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />
          <span className="text-sm font-sans tracking-wide font-light">
            Decrypting shared moments...
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full w-full bg-wine-950 flex flex-col items-center justify-center p-6 text-center select-none text-butter-300 gap-4">
        <div className="w-16 h-16 rounded-full bg-rose-950/40 flex items-center justify-center border border-rose-500/10 text-rose-400 mb-2">
          <MessageSquare className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold font-sans text-butter-100">Conversation Not Found</h2>
        <p className="text-sm text-butter-300 font-light max-w-sm leading-relaxed">
          {error}
        </p>
        <button
          onClick={onBackToApp}
          className="mt-4 px-5 py-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-semibold font-sans text-sm transition-all duration-300 flex items-center gap-2"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Maya</span>
        </button>
      </div>
    )
  }

  const messages = session?.messages || []
  const title = session?.title?.replace(/👥\s*/g, '').trim() || "Shared Conversation"
  const isGroupChat = title.toLowerCase().includes("group")

  return (
    <div className="h-full w-full bg-wine-950 flex flex-col overflow-hidden relative">
      {/* Top Header */}
      <header className="h-16 px-6 border-b border-wine-800/40 flex items-center justify-between z-10 bg-wine-900/60 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
            <Heart className="w-4.5 h-4.5 text-rose-300 fill-transparent animate-emotional-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold text-butter-50 font-sans leading-none">Maya</span>
            <span className="text-[10px] text-butter-300 font-light mt-1 flex items-center gap-1 select-none leading-none">
              <span>{isGroupChat ? "Group Chat Room" : "Shared Chat"}</span>
              <span>•</span>
              <span className="italic">{isGroupChat ? "Collaborative discussion" : "Read-only transcript"}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Share/Export button */}
          <button
            onClick={() => setIsShareModalOpen(true)}
            className="px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider font-sans border border-rose-500/20 bg-rose-500/10 text-rose-300 hover:text-rose-200 hover:bg-rose-500/20 transition-all duration-300 flex items-center gap-1.5 cursor-pointer shrink-0"
            title="Export conversation logs"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export Transcript</span>
          </button>

          <button
            onClick={onBackToApp}
            className="px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider font-sans border border-rose-500/20 bg-wine-950/40 text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 transition-all duration-300 flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Go to App</span>
          </button>
        </div>
      </header>

      {/* Shared Conversation Transcript Body */}
      <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 space-y-6 w-full max-w-4xl mx-auto flex flex-col">
        {/* Header Banner */}
        <div className="text-center py-6 border-b border-rose-500/10 flex flex-col items-center gap-3 select-none shrink-0">
          <span className="px-3 py-1 rounded-full text-[10px] font-sans font-bold uppercase tracking-wider bg-rose-500/10 text-rose-300 border border-rose-500/20 animate-pulse">
            {isGroupChat ? "Collaborative Room Active" : "Shared Link Active"}
          </span>
          <h1 className="text-2xl md:text-3xl font-extrabold text-butter-100 font-sans tracking-tight leading-tight px-4">
            {title}
          </h1>
          <p className="text-xs text-butter-300 font-light tracking-wide max-w-md">
            {isGroupChat 
              ? "Multiple users can chat in this shared room together. Maya responds contextually to everyone using the host's Mind Space!" 
              : "This conversation log with Maya has been shared with you. You are viewing a read-only snapshot."}
          </p>
        </div>

        {/* Message Log */}
        <div className="flex-1 flex flex-col gap-6 pt-4 min-h-0">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-butter-300 italic font-light font-sans">
              No messages found. Start the conversation below!
            </div>
          ) : (
            // Sort messages by created_at timestamp to ensure chronological order and proper blending for group chats
            [...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((msg) => renderMessage(msg))
          )}


          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Floating Bottom Promo Footer */}
      <div className="p-4 px-6 border-t border-wine-800/40 bg-wine-950/70 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4 select-none shrink-0">
        <div className="flex flex-col text-center sm:text-left gap-0.5">
          {isGroupChat ? (
            <>
              <span className="text-sm font-bold text-rose-600 font-sans">Join this group chat</span>
              <span className="text-xs text-rose-500 font-light">Add your voice to the collaborative conversation.</span>
            </>
          ) : (
            <>
              <span className="text-sm font-bold text-rose-600 font-sans">Want to save a copy?</span>
              <span className="text-xs text-rose-500 font-light">Copy this entire discussion directly into your own account.</span>
            </>
          )}
        </div>
        <button
          onClick={handleContinueClick}
          disabled={isCloning}
          className="px-5 py-2.5 rounded-xl font-bold font-sans text-xs bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white hover:scale-102 active:scale-98 transition-all duration-300 flex items-center gap-2 shadow-[0_0_20px_rgba(158, 2, 50, 0.35)] cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        >
          <span className="text-white font-bold">
            {isCloning ? "Cloning..." : (isGroupChat ? "Join Chat" : "Continue Chat")}
          </span>
          <ArrowRight className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Collaborative Input Bar at the very bottom - Only visible for group chats */}
      {isGroupChat && (
        <div className="p-4 border-t border-wine-800/40 bg-wine-900/30 backdrop-blur-md shrink-0">
          <form onSubmit={handleSend} className="flex gap-2 items-center max-w-4xl mx-auto w-full">
            {/* Guest Name input */}
            <div className="relative shrink-0 select-none">
              <input
                type="text"
                value={guestName}
                maxLength={15}
                onChange={(e) => {
                  const val = e.target.value || "Guest"
                  setGuestName(val)
                  localStorage.setItem('group_chat_guest_name', val)
                }}
                placeholder="Your Name"
                className="w-24 sm:w-32 px-3 py-3 rounded-xl bg-wine-950 border border-rose-500/20 text-butter-100 text-xs font-semibold uppercase tracking-wide focus:outline-none focus:border-rose-500/40 transition-colors text-center font-sans"
                title="Enter your name to chat in the room"
              />
            </div>
            
            {/* Chat input */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend(e)
                }
              }}
              disabled={sending}
              placeholder={sending ? "Maya is responding..." : "Type a message..."}
              rows={1}
              style={{ maxHeight: '150px' }}
              className="flex-1 min-w-0 px-4 py-3 rounded-xl rose-input font-sans text-base focus:outline-none bg-wine-950 text-butter-50 border border-rose-500/20 focus:border-rose-500/40 resize-none overflow-y-auto"
            />

            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="p-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-butter-50 transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none hover:shadow-lg hover:shadow-rose-500/25 shrink-0 flex items-center justify-center cursor-pointer"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 text-wine-900 animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-wine-900" />
              )}
            </button>
          </form>
        </div>
      )}

      {isShareModalOpen && (
        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          sessionId={sessionId}
          sessionTitle={title}
        />
      )}
    </div>
  )
}
