import React, { useState, useEffect, useRef } from 'react'
import { useChat } from '../context/ChatContext'
import { Search, X, MessageSquare, Clock } from 'lucide-react'

export default function SearchModal() {
  const {
    sessions,
    sessionsMessages,
    isSearchOpen,
    setIsSearchOpen,
    activeSessionId,
    setActiveSessionId
  } = useChat()

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus input automatically when search opens
  useEffect(() => {
    if (isSearchOpen) {
      setQuery("")
      setTimeout(() => {
        if (inputRef.current) inputRef.current.focus()
      }, 50)
    }
  }, [isSearchOpen])

  // Filter logic
  const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  const filteredSessions = sessions.filter(session => {
    if (!query.trim()) return true
    const q = query.toLowerCase().trim()
    const titleMatch = (session.title || "").toLowerCase().includes(q)
    if (titleMatch) return true

    const msgs = sessionsMessages[session.id] || []
    return msgs.some(m => (m.content || "").toLowerCase().includes(q))
  })

  // Limit to recent chats if query is empty
  const displayedSessions = query.trim() ? filteredSessions : sessions.slice(0, 6)

  // Handle select / switch session
  const handleSelect = (session) => {
    if (!session) return
    setActiveSessionId(session.id)
    setIsSearchOpen(false)
    setQuery("")
  }

  // Keyboard navigation inside search panel
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isSearchOpen) return

      if (e.key === 'Escape') {
        e.preventDefault()
        setIsSearchOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(displayedSessions.length - 1, prev + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(0, prev - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (displayedSessions[selectedIndex]) {
          handleSelect(displayedSessions[selectedIndex])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSearchOpen, displayedSessions, selectedIndex])

  // Scroll selected item into view automatically
  useEffect(() => {
    if (listRef.current) {
      const selectedItem = listRef.current.children[selectedIndex]
      if (selectedItem) {
        selectedItem.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth'
        })
      }
    }
  }, [selectedIndex])

  if (!isSearchOpen) return null

  // Utility to find and extract matched message snippet
  const getMatchSnippet = (session) => {
    const q = query.toLowerCase().trim()
    const msgs = sessionsMessages[session.id] || []

    if (!q) {
      // If query is empty, show a preview of the last message in that chat
      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1]
        const preview = lastMsg.content.trim()
        return {
          snippet: preview.length > 85 ? preview.slice(0, 85) + "..." : preview,
          role: lastMsg.role,
          queryText: ""
        }
      }
      return null
    }

    // Find first message containing query
    const matchMsg = msgs.find(m => (m.content || "").toLowerCase().includes(q))
    if (!matchMsg) return null

    const text = matchMsg.content
    const index = text.toLowerCase().indexOf(q)
    if (index === -1) return null

    const start = Math.max(0, index - 25)
    const end = Math.min(text.length, index + q.length + 45)

    let snippet = text.slice(start, end)
    if (start > 0) snippet = "..." + snippet
    if (end < text.length) snippet = snippet + "..."

    return {
      snippet,
      role: matchMsg.role,
      queryText: text.slice(index, index + q.length)
    }
  }

  return (
    <div
      onClick={() => setIsSearchOpen(false)}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 bg-wine-950/60 backdrop-blur-sm animate-fade-in"
    >
      {/* Search Modal Card */}
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl bg-wine-900 border border-rose-500/20 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[60vh] animate-spotlight-entry"
      >
        {/* Header Input Section */}
        <div className="relative flex items-center px-4 border-b border-rose-500/10 h-14 shrink-0 bg-wine-950/30">
          <Search className="w-5 h-5 text-rose-500/50 mr-3" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search conversations, keywords or messages..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-transparent border-0 text-rose-500 placeholder-rose-500/40 text-sm font-sans focus:outline-none h-full py-3 pr-8"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 text-rose-500/40 hover:text-rose-500/80 rounded-full hover:bg-rose-500/10 transition-colors mr-2"
              title="Clear Search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsSearchOpen(false)}
            className="p-1 text-rose-500/30 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors text-[10px] font-sans px-1.5 py-0.5 border border-rose-500/10"
            title="Close Search (Esc)"
          >
            ESC
          </button>
        </div>

        {/* Results / Suggestions list */}
        <div className="flex-1 overflow-y-auto p-2" ref={listRef}>
          {/* Section Header */}
          <div className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-rose-500/70 uppercase font-sans flex items-center gap-1.5">
            {query.trim() ? (
              <>
                <Search className="w-3 h-3" />
                <span>Search Results</span>
              </>
            ) : (
              <>
                <Clock className="w-3 h-3" />
                <span>Recent Chats</span>
              </>
            )}
          </div>

          {displayedSessions.length === 0 ? (
            <div className="text-center py-12 text-rose-500/60 font-sans text-sm italic">
              No conversations match your search.
            </div>
          ) : (
            displayedSessions.map((session, idx) => {
              const isSelected = selectedIndex === idx
              const match = getMatchSnippet(session)

              let snippetParts = []
              if (match && match.queryText) {
                snippetParts = match.snippet.split(new RegExp(`(${escapeRegExp(match.queryText)})`, 'gi'))
              }

              return (
                <div
                  key={session.id}
                  onClick={() => handleSelect(session)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-start gap-3.5 px-4 py-3 rounded-xl cursor-pointer transition-all duration-150 border border-transparent ${
                    isSelected
                      ? 'bg-rose-500/10 border-rose-500/20 shadow-sm'
                      : 'hover:bg-wine-800/40'
                  }`}
                >
                  {/* Left Side Icon Container */}
                  <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center border transition-colors ${
                    isSelected
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-500'
                      : 'bg-wine-950/40 border-rose-500/10 text-rose-500/60'
                  }`}>
                    <MessageSquare className="w-4 h-4" />
                  </div>

                  {/* Text Details Area */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <span className={`text-xs font-semibold font-sans truncate transition-colors ${
                      isSelected ? 'text-rose-500 font-bold' : 'text-rose-500/80'
                    }`}>
                      {session.title?.trim() || "New Chat"}
                    </span>

                    {/* Matching / Last Message Snippet */}
                    {match && (
                      <div className={`text-[11px] font-sans leading-relaxed tracking-wide mt-0.5 line-clamp-1 italic ${
                        isSelected ? 'text-rose-500/70 font-light' : 'text-rose-500/50 font-light'
                      }`}>
                        <span className="font-medium mr-0.5">{match.role === 'user' ? 'You: ' : 'Maya: '}</span>
                        {match.queryText ? (
                          snippetParts.map((part, i) =>
                            part.toLowerCase() === match.queryText.toLowerCase() ? (
                              <mark key={i} className={`bg-rose-500/20 text-rose-600 rounded px-0.5 font-bold`}>
                                {part}
                              </mark>
                            ) : (
                              <span key={i}>{part}</span>
                            )
                          )
                        ) : (
                          <span>{match.snippet}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer help guide */}
        <div className="h-8 border-t border-rose-500/5 px-4 flex items-center justify-between text-[9px] font-sans text-rose-500/40 bg-wine-950/20 shrink-0 select-none">
          <div className="flex items-center gap-3">
            <span><kbd className="border border-rose-500/10 rounded px-1 bg-wine-950/40">↑↓</kbd> to navigate</span>
            <span><kbd className="border border-rose-500/10 rounded px-1 bg-wine-950/40">Enter</kbd> to select</span>
          </div>
          <span>Esc to dismiss</span>
        </div>
      </div>
    </div>
  )
}
