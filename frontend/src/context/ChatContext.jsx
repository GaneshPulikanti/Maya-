import React, { createContext, useState, useContext, useEffect, useRef } from 'react'
import { api, useAuth } from './AuthContext'

const ChatContext = createContext(null)

export const ChatProvider = ({ children }) => {
  const { token, user } = useAuth()
  const [sessions, setSessions] = useState([])
  const [activeSessionId, _setActiveSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [sessionsMessages, setSessionsMessages] = useState({})
  const [streamingMessage, setStreamingMessage] = useState(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showSharedViewOnly, setShowSharedViewOnly] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  // AbortController ref for cancelling active streams
  const abortControllerRef = useRef(null)

  // Race condition refs (sync during render)
  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming

  // Prefetching sessions tracking ref
  const prefetchingRef = useRef(new Set())
  const isInitializingRef = useRef(false)
  const contextAudioRef = useRef(null)

  // Voice assistant enabled state — persisted to localStorage
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem('maya_voice_enabled')
      return stored !== null ? JSON.parse(stored) : false
    } catch {
      return false
    }
  })

  // Persist voice preference whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('maya_voice_enabled', JSON.stringify(voiceEnabled))
    } catch {}
    if (!voiceEnabled && contextAudioRef.current) {
      try {
        contextAudioRef.current.pause()
        contextAudioRef.current.src = ''
        if (document.body.contains(contextAudioRef.current)) {
          document.body.removeChild(contextAudioRef.current)
        }
      } catch (e) {}
      contextAudioRef.current = null
    }
  }, [voiceEnabled])

  // Clone a shared chat session into the authenticated user's account
  const cloneSession = async (sharedSessionId) => {
    if (!token) return null
    try {
      const response = await api.post(`/api/chat/sessions/clone/${sharedSessionId}`)
      const newSession = response.data
      setSessions(prev => [newSession, ...prev])
      _setActiveSessionId(newSession.id)
      setShowSharedViewOnly(false)
      window.history.pushState({}, '', `/chat/${newSession.id}`)
      return newSession
    } catch (error) {
      console.error("Failed to clone shared session:", error)
      throw error
    }
  }

  // Join a shared group chat session, keeping it completely synced with the original
  const joinSession = async (sharedSessionId) => {
    if (!token) return null
    try {
      const response = await api.post(`/api/chat/sessions/join/${sharedSessionId}`)
      const joinedSession = response.data
      
      // If the session isn't already in our list, add it
      setSessions(prev => {
        if (!prev.find(s => s.id === joinedSession.id)) {
          return [joinedSession, ...prev]
        }
        return prev
      })
      
      _setActiveSessionId(joinedSession.id)
      setShowSharedViewOnly(false)

      const isGroup = joinedSession.title?.toLowerCase().includes('group')
      const isShared = joinedSession.user_id !== user?.id
      const targetPath = isGroup 
        ? `/group/${joinedSession.id}` 
        : (isShared ? `/share/${joinedSession.id}` : `/chat/${joinedSession.id}`)

      window.history.pushState({}, '', targetPath)
      return joinedSession
    } catch (error) {
      console.error("Failed to join shared session:", error)
      throw error
    }
  }

  // Fetch session listings
  const fetchSessions = async () => {
    if (!token) return
    setLoadingSessions(true)
    try {
      const response = await api.get('/api/chat/sessions')
      setSessions(response.data)
      
      const pathParts = window.location.pathname.split('/')
      const isSharedOrGroup = pathParts[1] === 'share' || pathParts[1] === 'group'
      const sharedSessionId = isSharedOrGroup && pathParts[2] ? pathParts[2] : null
      const continueSharedId = sessionStorage.getItem('continue_shared_session_id')
      const joinSharedId = sessionStorage.getItem('join_shared_session_id')

      if (joinSharedId) {
        sessionStorage.removeItem('join_shared_session_id')
        joinSession(joinSharedId).catch(err => {
          console.error("Failed to auto-join session on login:", err)
        })
      } else if (continueSharedId) {
        sessionStorage.removeItem('continue_shared_session_id')
        cloneSession(continueSharedId).catch(err => {
          console.error("Failed to auto-clone shared session on login:", err)
        })
      } else if (sharedSessionId) {
        // If they already joined this session, select it and show dashboard, otherwise show read-only view
        const alreadyJoined = response.data.find(s => s.id === sharedSessionId)
        if (alreadyJoined) {
          _setActiveSessionId(sharedSessionId)
          setShowSharedViewOnly(false)
        } else {
          setShowSharedViewOnly(true)
        }
      } else {
        const justLoggedIn = sessionStorage.getItem('just_logged_in') === 'true'
        if (justLoggedIn) {
          sessionStorage.removeItem('just_logged_in')
          if (!isInitializingRef.current) {
            isInitializingRef.current = true
            createSession("New Conversation").catch(err => {
              console.error("Failed to auto-create session upon login:", err)
            }).finally(() => { isInitializingRef.current = false })
          }
        } else if (response.data.length > 0) {
          // On plain page refresh, prefer creating/selecting a fresh "New Conversation"
          // instead of restoring the last-left session. This gives users a new chat
          // when they reload the page (per user request).
          if (!activeSessionId && !isInitializingRef.current) {
            isInitializingRef.current = true
            createSession("New Conversation").catch(err => {
              // If creating a new session fails for any reason, fall back to first session
              console.error("Auto-create session failed on load, falling back:", err)
              _setActiveSessionId(response.data[0].id)
            }).finally(() => { isInitializingRef.current = false })
          }
        } else {
          // Auto-initialize a fresh session if user has no sessions
          if (!isInitializingRef.current) {
            isInitializingRef.current = true
            createSession("New Conversation").catch(err => {
              console.error("Failed to auto-create session:", err)
            }).finally(() => { isInitializingRef.current = false })
          }
        }
      }
    } catch (error) {
      console.error("Failed to load chat sessions:", error)
    } finally {
      setLoadingSessions(false)
    }
  }


  // Load active session messages
  const fetchMessages = async (sessionId, isBackground = false) => {
    if (!token || !sessionId || sessionId === 'new') return
    if (!isBackground) setLoadingMessages(true)
    try {
      const response = await api.get(`/api/chat/sessions/${sessionId}/messages?t=${Date.now()}`)
      
      // Prevent race conditions where old requests resolve after changing sessions
      if (activeSessionIdRef.current !== sessionId) return
      
      // Prevent background polling from overwriting optimistic local messages during streams
      if (isBackground && isStreamingRef.current) return

      const msgs = response.data

      // Silently purge orphaned assistant messages — those left behind when only
      // the user message was deleted (old behaviour before pair-delete was added).
      // An assistant message is "orphaned" when the message directly before it is
      // also an assistant message (or it's the very first message in the session).
      const orphanIds = []
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === 'assistant') {
          const prev = i > 0 ? msgs[i - 1] : null
          if (!prev || prev.role === 'assistant') {
            orphanIds.push(msgs[i].id)
          }
        }
      }

        const mergeWithPrev = (serverMsgs, prevMsgs) => {
          if (!isBackground) return serverMsgs;
          return serverMsgs.map((serverMsg, idx) => {
            const prevMsg = prevMsgs[idx];
            // If the message occupies the same index and has the same role, it's structurally the same message
            if (prevMsg && prevMsg.role === serverMsg.role && prevMsg.client_id) {
              return { ...serverMsg, client_id: prevMsg.client_id };
            }
            return serverMsg;
          });
        };

        if (orphanIds.length > 0) {
          // Fire deletes in parallel — best-effort; ignore individual failures
          if (!isBackground) {
            await Promise.allSettled(
              orphanIds.map(id => api.delete(`/api/chat/messages/${id}`))
            )
          }
          const filtered = msgs.filter(m => !orphanIds.includes(m.id))
          setMessages(prev => {
            if (isBackground && prev.length === filtered.length && (filtered.length === 0 || prev[prev.length-1]?.id === filtered[filtered.length-1]?.id)) {
              return prev;
            }
            const merged = mergeWithPrev(filtered, prev);
            setSessionsMessages(sPrev => ({ ...sPrev, [sessionId]: merged }))
            return merged;
          })
        } else {
          setMessages(prev => {
            if (isBackground && prev.length === msgs.length && (msgs.length === 0 || prev[prev.length-1]?.id === msgs[msgs.length-1]?.id)) {
              return prev;
            }
            const merged = mergeWithPrev(msgs, prev);
            setSessionsMessages(sPrev => ({ ...sPrev, [sessionId]: merged }))
            return merged;
          })
        }
    } catch (error) {
      console.error("Failed to load message history:", error)
    } finally {
      if (!isBackground) setLoadingMessages(false)
    }
  }

  // Reload history whenever active session changes
  useEffect(() => {
    if (activeSessionId) {
      if (!isStreamingRef.current) {
        setMessages([]) // Instantly clear messages to prevent leaking/flashing previous conversation
        fetchMessages(activeSessionId)
      }
    } else {
      setMessages([])
    }
  }, [activeSessionId])

  // Background polling for active session to keep chats in sync
  useEffect(() => {
    let intervalId;
    if (activeSessionId && !isStreaming && !showSharedViewOnly) {
      const activeSess = sessions.find(s => s.id === activeSessionId)
      const isGroup = activeSess?.title?.toLowerCase().includes('group')
      const intervalDelay = isGroup ? 1000 : 2000
      intervalId = setInterval(() => {
        fetchMessages(activeSessionId, true)
      }, intervalDelay)
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [activeSessionId, isStreaming, showSharedViewOnly, sessions])

  // Reload sessions on auth
  useEffect(() => {
    if (token) {
      fetchSessions()
    } else {
      setSessions([])
      _setActiveSessionId(null)
      setMessages([])
      setSessionsMessages({})
      setShowSharedViewOnly(false)
      const pathParts = window.location.pathname.split('/')
      const isSharedPath = (pathParts[1] === 'share' || pathParts[1] === 'group') && pathParts[2]
      if (!isSharedPath && window.location.pathname !== '/') {
        window.history.pushState({}, '', '/')
      }
    }
  }, [token])

  // Sync active session messages to sessionsMessages cache
  useEffect(() => {
    if (activeSessionId && messages) {
      setSessionsMessages(prev => ({ ...prev, [activeSessionId]: messages }))
    }
  }, [messages, activeSessionId])

  // Global keyboard shortcut to toggle spotlight search modal (Cmd+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsSearchOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Preload messages for the most recent 3 sessions in the background to ensure snappy switching
  useEffect(() => {
    const preload = async () => {
      if (!token || sessions.length === 0) return
      // Only preload the top 3 sessions
      const topSessions = sessions.slice(0, 3)
      
      const promises = topSessions.map(async (session) => {
        // Use a functional state check to prevent loading if already in sessionsMessages ref/state
        if (prefetchingRef.current.has(session.id)) return
        
        prefetchingRef.current.add(session.id)
        try {
          const response = await api.get(`/api/chat/sessions/${session.id}/messages?t=${Date.now()}`)
          setSessionsMessages(prev => {
            if (prev[session.id]) return prev // already loaded
            return { ...prev, [session.id]: response.data }
          })
        } catch (error) {
          console.error(`Failed to preload messages for session ${session.id}:`, error)
        } finally {
          prefetchingRef.current.delete(session.id)
        }
      })
      
      await Promise.all(promises)
    }
    preload()
  }, [sessions, token])

  // Dynamically synchronize the browser URL path with activeSessionId
  useEffect(() => {
    if (token) {
      if (showSharedViewOnly) return

      const pathParts = window.location.pathname.split('/')
      const isSharedOrGroup = pathParts[1] === 'share' || pathParts[1] === 'group'

      if (activeSessionId) {
        const activeSess = sessions.find(s => s.id === activeSessionId)
        let expectedPath = `/chat/${activeSessionId}`
        if (activeSess) {
          const isGroup = activeSess.title?.toLowerCase().includes('group')
          const isShared = activeSess.user_id !== user?.id
          if (isGroup) {
            expectedPath = `/group/${activeSessionId}`
          } else if (isShared) {
            expectedPath = `/share/${activeSessionId}`
          }
        }
        if (window.location.pathname !== expectedPath) {
          window.history.pushState({}, '', expectedPath)
        }
      } else {
        if (!isSharedOrGroup && window.location.pathname !== '/') {
          window.history.pushState({}, '', '/')
        }
      }
    }
  }, [activeSessionId, token, showSharedViewOnly, sessions, user])


  // Create new session
  const createSession = async (title = "New Conversation") => {
    if (title === "Group Chat Room") {
      try {
        const response = await api.post('/api/chat/sessions', { title })
        const newSession = response.data
        setSessions(prev => [newSession, ...prev])
        _setActiveSessionId(newSession.id)
        setMessages([])
        return newSession
      } catch (error) {
        console.error("Failed to create group session:", error)
        throw error
      }
    }
    // Just switch to the "new" virtual session state. 
    // The actual DB session will be created when the first message is sent.
    _setActiveSessionId("new")
    setMessages([])
    return { id: "new", title }
  }

  // Delete session
  const deleteSession = async (sessionId, isAutoPurge = false) => {
    if (sessionId === 'new') {
      setActiveSessionId(null)
      setMessages([])
      return
    }

    try {
      await api.delete(`/api/chat/sessions/${sessionId}`)
      setSessions(prev => prev.filter(s => s.id !== sessionId))
      setSessionsMessages(prev => {
        const copy = { ...prev }
        delete copy[sessionId]
        return copy
      })
      if (!isAutoPurge && activeSessionId === sessionId) {
        const remaining = sessions.filter(s => s.id !== sessionId)
        if (remaining.length > 0) {
          _setActiveSessionId(remaining[0].id)
        } else {
          // Auto-create a fresh new session if last one is deleted
          createSession("New Conversation").catch(err => {
            console.error("Failed to auto-create session after delete:", err)
          })
        }
      }
    } catch (error) {
      console.error("Failed to delete session:", error)
      throw error
    }
  }

  // Custom wrapped active session state setter with automatic empty session purge
  const setActiveSessionId = (nextId, isCreatingNewSession = false) => {
    _setActiveSessionId(nextId)
  }

  // Rename session
  const renameSession = async (sessionId, newTitle) => {
    if (sessionId === 'new') return { id: 'new', title: newTitle }
    try {
      const response = await api.put(`/api/chat/sessions/${sessionId}`, { title: newTitle })
      const updatedSession = response.data
      setSessions(prev => prev.map(s => s.id === sessionId ? updatedSession : s))
      return updatedSession
    } catch (error) {
      console.error("Failed to rename session:", error)
      throw error
    }
  }

  // Abort the active stream and commit whatever partial text was generated
  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  // Custom fetch-based SSE real-time token stream reader
  const sendMessage = async (content, isVoice = false) => {
    if (!activeSessionId || !content.trim() || isStreaming) return

    const userMessage = {
      id: `local-usr-${Date.now()}`,
      client_id: `local-usr-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      created_at: new Date().toISOString(),
      isLocal: true
    }

    // Add user message locally for instant visual feedback
    const assistantMessageId = `local-ast-${Date.now()}`
    const initialAssistantMessage = {
      id: assistantMessageId,
      client_id: assistantMessageId,
      role: 'assistant',
      content: "",
      created_at: new Date().toISOString(),
      isLocal: true
    }
    
    // Instantly show the messages on the screen so the user doesn't wait for session creation!
    setMessages(prev => [...prev, userMessage, initialAssistantMessage])
    setIsStreaming(true)
    setStreamingMessage("")

    let currentSessionId = activeSessionId

    // Bubble the active session to the top immediately for snappy UI
    if (currentSessionId && currentSessionId !== 'new') {
      setSessions(prev => {
        const idx = prev.findIndex(s => s.id === currentSessionId)
        if (idx > 0) {
          const copy = [...prev]
          const [moved] = copy.splice(idx, 1)
          return [moved, ...copy]
        }
        return prev
      })
    }
    
    // If this is the first message in a virtual "new" session, create the real session now in the background
    if (currentSessionId === 'new') {
      try {
        const response = await api.post('/api/chat/sessions', { title: "New Conversation" })
        const newSession = response.data
        setSessions(prev => [newSession, ...prev])
        currentSessionId = newSession.id
        setActiveSessionId(currentSessionId, true)
      } catch (error) {
        console.error("Failed to create session for first message:", error)
        setIsStreaming(false)
        return
      }
    }
    
    // Create a fresh AbortController for this stream
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const baseUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:10000"

    try {
      // Use raw fetch for handling stream tokens with bearer auth
      const response = await fetch(`${baseUrl}/api/chat/sessions/${currentSessionId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content: content.trim(), is_voice: isVoice }),
        signal: abortController.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || 'Failed to connect to assistant stream.')
      }

      // Fetch updated session listings instantly so the sidebar updates its title
      fetchSessions()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let partialChunk = ""
      let fullAssistantText = ""
      let streamAborted = false

      const tokenQueue = []
      let isReadingFinished = false

      // Artificial typewriter effect loop
      const renderPromise = (async () => {
        while (!isReadingFinished || tokenQueue.length > 0) {
          if (tokenQueue.length > 0) {
            const token = tokenQueue.shift()
            fullAssistantText += token
            setStreamingMessage(fullAssistantText)
            
            setMessages(prev => prev.map(m => 
              m.id === assistantMessageId ? { ...m, content: fullAssistantText } : m
            ))
            
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
              if (dataStr === '[DONE]') {
                break
              }

              try {
                const parsed = JSON.parse(dataStr)
                if (parsed.token) {
                  tokenQueue.push(parsed.token)
                }
              } catch (e) {
                console.warn("Could not parse SSE token payload:", cleanedLine, e)
              }
            }
          }
        }
      } catch (readErr) {
        if (readErr.name === 'AbortError') {
          // Stream was intentionally stopped by the user
          streamAborted = true
          console.info("Stream generation stopped by user.")
        } else {
          throw readErr
        }
      } finally {
        isReadingFinished = true
        await renderPromise // Wait for the typewriter animation to finish before proceeding
        abortControllerRef.current = null
      }

      // Conclude Streaming — commit whatever text was generated (even if aborted)
      if (fullAssistantText.trim()) {
        const suffix = streamAborted ? ' *(stopped)*' : ''
        const finalContent = fullAssistantText + suffix
        setMessages(prev => prev.map(m => 
          m.id === assistantMessageId ? { ...m, content: finalContent, isLocal: true } : m
        ))
      } else {
        setMessages(prev => prev.filter(m => m.id !== assistantMessageId))
      }
      setStreamingMessage(null)
      setIsStreaming(false)

      // Touch / refresh session listings in background to bubble active session up
      fetchSessions()

      // Playback Maya's response — only when voice assistant is enabled and NOT in voice mode
      if (!streamAborted && voiceEnabled && !isVoice && fullAssistantText.trim()) {
        // Clean the text for speech (remove markdown, code blocks, etc.)
        const ttsText = fullAssistantText
          .replace(/```[\s\S]*?```/g, 'a code block')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/#{1,6}\s/g, '')
          .replace(/\[.*?\]\(.*?\)/g, '')
          .replace(/[|\-]{3,}/g, '')
          .replace(/\n{2,}/g, '. ')
          .trim()

        const ttsTextSliced = ttsText.slice(0, 160) // Short slice for Orpheus to avoid TPD rate limits

        const runOrpheus = async () => {
          if (contextAudioRef.current) {
            try {
              contextAudioRef.current.pause()
              contextAudioRef.current.src = ''
              if (document.body.contains(contextAudioRef.current)) {
                document.body.removeChild(contextAudioRef.current)
              }
            } catch (e) {}
            contextAudioRef.current = null
          }

          const audio = document.createElement('audio')
          audio.style.display = 'none'
          audio.setAttribute("playsinline", "true")
          document.body.appendChild(audio)
          contextAudioRef.current = audio

          const cleanup = () => {
            try {
              if (document.body.contains(audio)) {
                document.body.removeChild(audio)
              }
            } catch (e) {}
            if (contextAudioRef.current === audio) {
              contextAudioRef.current = null
            }
          }

          try {
            const token = localStorage.getItem('token')
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {}
            const speakResponse = await api.post(
              '/api/voice/speak',
              { text: ttsTextSliced, voice: 'diana' },
              { responseType: 'blob', timeout: 12000, headers }
            )

            if (speakResponse.status === 200 && speakResponse.data?.size > 0 && contextAudioRef.current === audio) {
              const base64Url = await new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.readAsDataURL(speakResponse.data)
                reader.onloadend = () => resolve(reader.result)
                reader.onerror = reject
              })

              audio.onended = () => cleanup()
              audio.onerror = () => {
                cleanup()
                console.warn("Orpheus audio element error")
              }
              audio.src = base64Url
              await audio.play().catch((err) => {
                console.warn("Auto-play Orpheus TTS failed:", err)
                cleanup()
              })
            } else {
              cleanup()
              console.warn("Orpheus speak request failed")
            }
          } catch (err) {
            console.warn('Groq Orpheus TTS auto-play failed:', err?.response?.status || err.message)
            cleanup()
          }
        }

        runOrpheus()
      }

    } catch (error) {
      console.error("Streaming transaction crashed:", error)
      const errMessage = {
        id: `local-err-${Date.now()}`,
        role: 'assistant',
        content: `*Maya hugs you close* "I'm so sorry, sweetie. I had a tiny glitch trying to connect. Could you try sending that again?" (Error: ${error.message})`,
        created_at: new Date().toISOString()
      }
      setMessages(prev => [...prev, errMessage])
      setStreamingMessage(null)
      setIsStreaming(false)
    }
  }

  // Delete a single message
  const deleteMessage = async (messageId) => {
    try {
      await api.delete(`/api/chat/messages/${messageId}`)
      setMessages(prev => prev.filter(m => m.id !== messageId))
    } catch (error) {
      console.error("Failed to delete message:", error)
      throw error
    }
  }

  // Delete a user message AND its immediately following assistant reply as a pair
  const deleteMessagePair = async (userMsgId, assistantMsgId) => {
    try {
      // Delete both from backend (assistant first to avoid FK issues)
      if (assistantMsgId) {
        await api.delete(`/api/chat/messages/${assistantMsgId}`)
      }
      await api.delete(`/api/chat/messages/${userMsgId}`)
      // Remove both from local state in one atomic update
      setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== assistantMsgId))
    } catch (error) {
      console.error("Failed to delete message pair:", error)
      throw error
    }
  }

  // Edit message
  const editMessage = async (messageId, newContent) => {
    try {
      const response = await api.put(`/api/chat/messages/${messageId}`, { content: newContent })
      const updatedMessage = response.data
      setMessages(prev => prev.map(m => m.id === messageId ? updatedMessage : m))
      return updatedMessage
    } catch (error) {
      console.error("Failed to edit message:", error)
      throw error
    }
  }

  // Regenerate Maya's reply after a user message has been edited
  const regenerateAfterEdit = async (userMessageId, onComplete) => {
    if (isStreaming) return

    const assistantMessageId = `local-ast-regen-${Date.now()}`
    const initialAssistantMessage = {
      id: assistantMessageId,
      client_id: assistantMessageId,
      role: 'assistant',
      content: "",
      created_at: new Date().toISOString(),
      isLocal: true
    }

    // Optimistically remove the old assistant reply and insert the new empty one
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === userMessageId)
      if (idx === -1) return prev
      const next = prev[idx + 1]
      let filtered = prev
      if (next && next.role === 'assistant') {
        filtered = prev.filter((_, i) => i !== idx + 1)
      }
      
      const newIdx = filtered.findIndex(m => m.id === userMessageId)
      if (newIdx !== -1) {
        return [
          ...filtered.slice(0, newIdx + 1),
          initialAssistantMessage,
          ...filtered.slice(newIdx + 1)
        ]
      }
      return [...filtered, initialAssistantMessage]
    })

    setIsStreaming(true)
    setStreamingMessage("")

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const baseUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:10000"

    try {
      const response = await fetch(`${baseUrl}/api/chat/messages/${userMessageId}/regenerate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        signal: abortController.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || 'Failed to regenerate response.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let partialChunk = ""
      let fullAssistantText = ""
      let streamAborted = false

      const tokenQueue = []
      let isReadingFinished = false

      // Artificial typewriter effect loop
      const renderPromise = (async () => {
        while (!isReadingFinished || tokenQueue.length > 0) {
          if (tokenQueue.length > 0) {
            const token = tokenQueue.shift()
            fullAssistantText += token
            setStreamingMessage(fullAssistantText)
            
            setMessages(prev => prev.map(m => 
              m.id === assistantMessageId ? { ...m, content: fullAssistantText } : m
            ))
            
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
                console.warn("Could not parse SSE token:", cleanedLine, e)
              }
            }
          }
        }
      } catch (readErr) {
        if (readErr.name === 'AbortError') {
          streamAborted = true
        } else {
          throw readErr
        }
      } finally {
        isReadingFinished = true
        await renderPromise // Wait for the typewriter animation to finish before proceeding
        abortControllerRef.current = null
      }

      if (fullAssistantText.trim()) {
        const suffix = streamAborted ? ' *(stopped)*' : ''
        const finalContent = fullAssistantText + suffix
        
        setMessages(prev => prev.map(m => 
          m.id === assistantMessageId ? { ...m, content: finalContent, isLocal: true } : m
        ))
        
        // Notify caller with the full text so it can store version history
        if (typeof onComplete === 'function') onComplete(finalContent)
      } else {
        setMessages(prev => prev.filter(m => m.id !== assistantMessageId))
      }

      setStreamingMessage(null)
      setIsStreaming(false)
      fetchSessions()
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error("Regeneration failed:", err)
      }
      setStreamingMessage(null)
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  return (
    <ChatContext.Provider value={{
      sessions,
      sessionsMessages,
      activeSessionId,
      setActiveSessionId,
      messages,
      streamingMessage,
      isStreaming,
      loadingSessions,
      loadingMessages,
      createSession,
      deleteSession,
      renameSession,
      sendMessage,
      stopGeneration,
      fetchSessions,
      fetchMessages,
      voiceEnabled,
      setVoiceEnabled,
      showSharedViewOnly,
      setShowSharedViewOnly,
      cloneSession,
      joinSession,
      deleteMessage,
      deleteMessagePair,
      editMessage,
      regenerateAfterEdit,
      isSearchOpen,
      setIsSearchOpen
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChat = () => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}
