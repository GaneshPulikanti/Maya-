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
  const [speakingId, setSpeakingId] = useState(null)
  const messagesEndRef = useRef(null)
  const currentSpeakRequestRef = useRef(0)
 
  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (window._activeSpeechAudio) {
        try {
          window._activeSpeechAudio.pause()
          if (document.body.contains(window._activeSpeechAudio)) {
            document.body.removeChild(window._activeSpeechAudio)
          }
        } catch (e) {}
        window._activeSpeechAudio = null
      }
    }
  }, [])
 
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
 
  const speakMessageText = async (text, msgId) => {
    const requestId = ++currentSpeakRequestRef.current
 
    if (speakingId === msgId) {
      currentSpeakRequestRef.current++ // Invalidate any pending requests
      if (window._activeSpeechAudio) {
        try {
          window._activeSpeechAudio.pause()
          if (document.body.contains(window._activeSpeechAudio)) {
            document.body.removeChild(window._activeSpeechAudio)
          }
        } catch (e) {}
        window._activeSpeechAudio = null
      }
      setSpeakingId(null)
      return
    }
 
    // Stop any currently playing audio first
    if (window._activeSpeechAudio) {
      try {
        window._activeSpeechAudio.pause()
        if (document.body.contains(window._activeSpeechAudio)) {
          document.body.removeChild(window._activeSpeechAudio)
        }
      } catch (e) {}
      window._activeSpeechAudio = null
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
 
    if (!clean) return
 
    setSpeakingId(msgId)
 
    let finished = false
 
    const done = () => {
      if (finished) return
      finished = true
      if (requestId === currentSpeakRequestRef.current) {
        setSpeakingId(prev => prev === msgId ? null : prev)
      }
    }
 
    try {
      const response = await api.post(
        '/api/voice/speak',
        { text: clean, voice: 'diana' },
        { responseType: 'blob', timeout: 15000 }
      )
      
      if (finished || requestId !== currentSpeakRequestRef.current) {
        return
      }
 
      if (response.status === 200 && response.data.size > 0) {
        // Switch to base64 Data URL to bypass Android WebView/Capacitor blob URL restrictions
        const base64Url = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.readAsDataURL(response.data)
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = reject
        })
 
        if (finished || requestId !== currentSpeakRequestRef.current) {
          return
        }
 
        // Create and append audio element to DOM to bypass WebView detached audio blocks
        const audio = document.createElement('audio')
        audio.style.display = 'none'
        audio.src = base64Url
        audio.setAttribute("playsinline", "true")
        document.body.appendChild(audio)
        window._activeSpeechAudio = audio
 
        const cleanup = () => {
          try {
            if (document.body.contains(audio)) {
              document.body.removeChild(audio)
            }
          } catch (e) {}
          if (window._activeSpeechAudio === audio) {
            window._activeSpeechAudio = null
          }
        }
 
        audio.onended = () => {
          cleanup()
          done()
        }
 
        audio.onerror = (e) => {
          console.warn("Orpheus audio element error:", e)
          cleanup()
          done()
        }
 
        try {
          await audio.play()
        } catch (err) {
          console.error("Orpheus play failed (falling back):", err)
          cleanup()
          done()
        }
      } else {
        done()
      }
    } catch (error) {
      console.warn("Orpheus TTS failed:", error)
      done()
    }
  }

  // 1. Setup continuous polling every 1 second to fetch latest messages for group collaboration (faster sync)
  useEffect(() => {
    if (!sessionId) return

    const fetchHistory = () => {
      api.get(`/api/chat/shared/${sessionId}?t=${Date.now()}`)
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

  // Only auto-scroll on initial load if we want to snap to bottom, but for shared views it's usually better to start at the top
  useEffect(() => {
    // Optional: scrollToBottom('smooth') could go here if desired, but user should see title first
  }, [session])

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

  const handleChatClick = () => {
    if (!user) {
      sessionStorage.setItem(isGroupChat ? 'join_shared_session_id' : 'continue_shared_session_id', sessionId)
      onBackToApp()
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

      const localGuestName = localStorage.getItem('maya_guest_name');
      const isMe = ((localGuestName && displayName === localGuestName) || (user?.email && (
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
      <div 
        onClick={handleChatClick}
        className={`flex-1 overflow-y-auto px-4 py-8 md:px-8 space-y-6 w-full max-w-4xl mx-auto flex flex-col ${!user ? 'cursor-pointer' : ''}`}
      >
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
            <>
            {[...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((msg) => renderMessage(msg))}
            
            {/* Global Typing Indicator for Group Chat Sync */}
            {messages.length > 0 && messages[messages.length - 1].role === 'user' && (
              <div className="flex flex-col max-w-[85%] transition-all duration-300 rounded-2xl self-start items-start w-full animate-bubble-entry">
                <div className="w-full flex flex-col min-w-0">
                  <div className="px-4 py-3 rounded-2xl text-base leading-relaxed font-sans shadow-md text-left w-max bg-rose-500/5 backdrop-blur-xs border border-rose-500/20 text-butter-100 rounded-tl-none shadow-rose-500/5">
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-1 select-none text-rose-400">
                      Maya
                    </div>
                    <div className="flex gap-1.5 items-center py-2">
                      <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
                      <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
                      <span className="w-2 h-2 rounded-full bg-rose-300 typing-dot" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            </>
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
