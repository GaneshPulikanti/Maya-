import React, { useState, useEffect, useRef } from 'react'
import { useChat } from '../context/ChatContext'
import { useAuth } from '../context/AuthContext'
import { MessageSquare, Plus, Trash2, LogOut, User, Menu, X, Heart, Pencil, Check, MoreVertical, Share2, Search, Users } from 'lucide-react'
import ShareModal from './ShareModal'

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

export default function Sidebar({ isOpen, toggleSidebar }) {
  const { 
    sessions, 
    sessionsMessages,
    activeSessionId, 
    setActiveSessionId, 
    createSession, 
    deleteSession, 
    renameSession,
    loadingSessions,
    setIsSearchOpen
  } = useChat()
  const { user, logout } = useAuth()
  const [deletingId, setDeletingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState("")
  const [activeMenuId, setActiveMenuId] = useState(null)
  const [shareSession, setShareSession] = useState(null)
  const menuRef = useRef(null)

  const getGroupInitials = (session) => {
    const msgs = (sessionsMessages && sessionsMessages[session.id]) || []
    const participants = new Set()
    
    if (user?.email) {
      participants.add(user.email.split('@')[0])
    }

    msgs.forEach(msg => {
      if (msg.role === 'user' && msg.content) {
        const nameMatch = msg.content.match(/^\[Reply to:[^\]]*\]\s*\[(.*?)\]:\s*(.*)$/s) || msg.content.match(/^\[(.*?)\]:\s*(.*)$/s)
        if (nameMatch) {
          participants.add(nameMatch[1])
        }
      }
    })

    const initialsList = Array.from(participants).map(name => {
      const cleanName = name.includes('@') ? name.split('@')[0] : name
      const userInitial = user?.email ? user.email[0].toUpperCase() : 'U'
      
      if (cleanName.toLowerCase() === 'user') return userInitial
      if (user?.email && (name.toLowerCase() === user.email.toLowerCase() || cleanName.toLowerCase() === user.email.split('@')[0].toLowerCase())) {
        return userInitial
      }
      
      const words = cleanName.trim().split(/[\s._-]+/)
      if (words.length >= 2 && words[0] && words[1]) {
        return (words[0][0] + words[1][0]).toUpperCase()
      }
      const text = cleanName.replace(/[^a-zA-Z0-9]/g, '')
      if (text.length >= 2) {
        return text.substring(0, 2).toUpperCase()
      }
      return (text || cleanName || 'U').substring(0, 2).toUpperCase()
    })

    const uniqueInitials = Array.from(new Set(initialsList))
    return uniqueInitials.length > 0 ? uniqueInitials : [user?.email ? user.email[0].toUpperCase() : 'U']
  }

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (activeMenuId && menuRef.current && !menuRef.current.contains(event.target)) {
        setActiveMenuId(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [activeMenuId])

  const toggleMenu = (e, sessionId) => {
    e.stopPropagation()
    setActiveMenuId(activeMenuId === sessionId ? null : sessionId)
  }

  const handleShareClick = (e, session) => {
    e.stopPropagation()
    setShareSession({ id: session.id, title: session.title })
    setActiveMenuId(null)
  }

  const handleRenameSubmit = async (e, sessionId) => {
    e.stopPropagation()
    if (!editTitle.trim()) {
      setEditingId(null)
      return
    }
    try {
      await renameSession(sessionId, editTitle.trim())
    } catch (err) {
      alert("Failed to rename conversation")
    } finally {
      setEditingId(null)
    }
  }

  const startRename = (e, session) => {
    e.stopPropagation()
    setEditingId(session.id)
    setEditTitle(session.title ? session.title.replace(/👥\s*/g, '') : "New Chat")
  }

  const handleCreate = async () => {
    try {
      await createSession("New Conversation")
      toggleSidebar()
    } catch (e) {
      alert("Failed to start new chat")
    }
  }

  const handleDelete = async (e, sessionId) => {
    e.stopPropagation() // Prevent selecting the session
    if (deletingId === sessionId) {
      try {
        await deleteSession(sessionId)
        setActiveMenuId(null)
      } catch (err) {
        alert("Failed to delete chat session")
      } finally {
        setDeletingId(null)
      }
    } else {
      setDeletingId(sessionId)
      // Automatically reset deleting confirmation state after 3 seconds
      setTimeout(() => setDeletingId(null), 3000)
    }
  }

  return (
    <>
      {/* Backdrop overlay */}
      {isOpen && (
        <div 
          onClick={toggleSidebar}
          className="fixed inset-0 z-30 bg-transparent transition-opacity duration-300 lg:hidden"
        />
      )}

      {/* Main Sidebar Drawer */}
      <aside 
        className={`fixed top-0 bottom-0 left-0 z-40 w-72 bg-wine-900/95 backdrop-blur-lg border-r border-rose-500/10 flex flex-col transition-transform duration-300 h-full ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-6 border-b border-wine-800/50 flex items-center justify-between">
          <div 
            onClick={handleCreate}
            className="flex items-center gap-2.5 cursor-pointer select-none hover:text-rose-600 transition-colors duration-300"
            title="Start New Chat"
          >
            <Heart className="w-5 h-5 text-rose-500 fill-transparent" />
            <span className="text-xl font-bold font-sans tracking-tight text-rose-500">Maya</span>
          </div>
          {/* Close Sidebar Button */}
          <button 
            onClick={toggleSidebar}
            className="text-butter-300 hover:text-rose-500 p-1.5 rounded-xl hover:bg-rose-500/10 transition-colors"
            title="Collapse Sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action: New Conversation */}
        <div className="p-4 pb-2">
          <button
            onClick={handleCreate}
            className="w-full py-2.5 px-4 rounded-xl border border-rose-500/20 hover:border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 text-rose-500 hover:text-rose-600 font-sans text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2 group"
          >
            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Search Conversations Trigger */}
        <div className="px-4 pb-2">
          <button
            onClick={() => setIsSearchOpen(true)}
            className="w-full py-2 px-3.5 rounded-xl border border-rose-500/10 hover:border-rose-500/20 bg-wine-950/20 hover:bg-wine-950/40 text-rose-500 hover:text-rose-600 font-sans text-xs font-medium transition-all duration-300 flex items-center justify-between group"
            title="Search chats (⌘K)"
          >
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-rose-500/50" />
              <span>Search chats...</span>
            </div>
            <kbd className="hidden sm:inline-block text-[9px] font-sans text-rose-500/40 bg-wine-900 border border-rose-500/10 px-1.5 py-0.5 rounded-md">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Conversation Logs Lists */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 select-none">
          <div className="px-3 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-500 font-sans">Conversations</span>
          </div>

          {loadingSessions && sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-butter-300 text-sm">
              <span className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mb-2" />
              <span>Loading logs...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-butter-300 text-sm font-light italic px-4">
              No conversations yet. Click "New Chat" to begin.
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = activeSessionId === session.id
              const isDeleting = deletingId === session.id
              const isGroup = session.title?.toLowerCase().includes("group")

              return (
                <div
                  key={session.id}
                  onClick={() => {
                    if (editingId === session.id) return // Don't switch active session while editing its name
                    setActiveSessionId(session.id)
                    toggleSidebar() // Close mobile drawer on choice
                  }}
                  className={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-sans cursor-pointer transition-all duration-300 relative border ${
                    isActive 
                      ? 'bg-rose-500 border-rose-600/10 text-white font-medium shadow-md shadow-rose-500/15' 
                      : 'border-transparent hover:bg-wine-800/30 text-butter-200 hover:text-butter-100'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <MessageSquare className={`w-4 h-4 shrink-0 mt-0.5 ${isActive ? 'text-white' : 'text-butter-300'}`} />
                    <div className="flex-1 min-w-0 flex flex-col">
                      {editingId === session.id ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={(e) => handleRenameSubmit(e, session.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameSubmit(e, session.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          className="bg-wine-950/60 border border-rose-500/30 text-butter-100 rounded px-1.5 py-0.5 text-xs font-sans focus:outline-none focus:border-rose-500/60 w-full"
                        />
                      ) : (
                        <span 
                          onDoubleClick={(e) => startRename(e, session)}
                          className="truncate font-light tracking-wide"
                          title="Double-click to rename"
                        >
                          {session.title?.replace(/👥\s*/g, '').trim() || "New Chat"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions: Dropdown options (Rename, Share, Delete) */}
                  {editingId !== session.id && (
                    <div 
                      className="relative shrink-0 flex items-center" 
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      {/* Overlapping participant avatars for group chats when not hovered/active */}
                      {isGroup && !isActive && activeMenuId !== session.id && (
                        <div className="flex items-center -space-x-2 transition-all duration-200 group-hover:opacity-0 group-hover:scale-75 absolute right-1.5 pointer-events-none">
                          <div className="w-5.5 h-5.5 rounded-full border border-wine-900 bg-rose-600 text-rose-50 flex items-center justify-center text-[9px] font-bold shadow-sm select-none">
                            M
                          </div>
                          {getGroupInitials(session).slice(0, 2).map((initial, idx) => (
                            <div 
                              key={idx}
                              className={`w-5.5 h-5.5 rounded-full border border-wine-900 ${getAvatarColor(initial)} flex items-center justify-center text-[9px] font-bold shadow-sm select-none`}
                            >
                              {initial}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Active session: show compact participant/account avatars left of the options menu */}
                      {isActive && (
                        <div className="flex items-center gap-1 mr-2">
                          {getGroupInitials(session).slice(0, 3).map((initial, idx) => (
                            <div
                              key={idx}
                              title={initial}
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold shadow-sm border border-wine-900 ${getAvatarColor(initial)}`}
                            >
                              {initial}
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={(e) => toggleMenu(e, session.id)}
                        className={`p-1.5 rounded-lg transition-all duration-200 focus-within:opacity-100 ${
                          isGroup 
                            ? (isActive || activeMenuId === session.id 
                                ? 'opacity-100 text-white hover:bg-white/10' 
                                : 'opacity-0 group-hover:opacity-100 text-butter-300 hover:text-rose-500 hover:bg-rose-500/10')
                            : (isActive 
                                ? 'opacity-100 text-white hover:bg-white/10' 
                                : 'opacity-0 group-hover:opacity-100 text-butter-300 hover:text-rose-500 hover:bg-rose-500/10')
                        }`}
                        title="Conversation Options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {activeMenuId === session.id && (
                        <div 
                          ref={menuRef}
                          className="absolute right-0 top-8 z-50 w-36 bg-wine-950 border border-rose-500/20 text-butter-200 shadow-xl rounded-xl p-1 flex flex-col gap-0.5 animate-bubble-entry"
                        >
                          {/* Rename Option */}
                          <button
                            onClick={(e) => {
                              startRename(e, session)
                              setActiveMenuId(null)
                            }}
                            className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-rose-500/10 text-butter-200 hover:text-rose-200 flex items-center gap-2 transition-all duration-150"
                          >
                            <Pencil className="w-3.5 h-3.5 text-rose-300/80" />
                            <span>Rename</span>
                          </button>

                          {/* Group Chat Option */}
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              setActiveMenuId(null)
                              try {
                                const currentTitle = session.title || "New Chat"
                                if (!currentTitle.toLowerCase().includes("group")) {
                                  await renameSession(session.id, `${currentTitle.replace('👥 ', '')} (Group)`)
                                }
                                handleShareClick(e, session)
                              } catch (err) {
                                console.error("Failed to convert to group chat:", err)
                              }
                            }}
                            className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-rose-500/10 text-butter-200 hover:text-rose-200 flex items-center gap-2 transition-all duration-150"
                          >
                            <Users className="w-3.5 h-3.5 text-rose-300/80" />
                            <span>Group Chat</span>
                          </button>

                          {/* Share Option */}
                          <button
                            onClick={(e) => handleShareClick(e, session)}
                            className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-rose-500/10 text-butter-200 hover:text-rose-200 flex items-center gap-2 transition-all duration-150"
                          >
                            <Share2 className="w-3.5 h-3.5 text-rose-300/80" />
                            <span>Share</span>
                          </button>

                          {/* Divider */}
                          <div className="h-[1px] bg-rose-500/10 my-0.5" />

                          {/* Delete Option */}
                          <button
                            onClick={(e) => handleDelete(e, session.id)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-all duration-150 ${
                              isDeleting
                                ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                                : 'hover:bg-rose-500/10 text-butter-200 hover:text-rose-300'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            <span>{isDeleting ? "Confirm?" : "Delete"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* User Footer Panel */}
        <div className="p-4 border-t border-wine-800/50 bg-wine-950/40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {(() => {
                const userInitial = user?.email ? user.email[0].toUpperCase() : 'U'
                const dpColor = getAvatarColor(user?.email || 'User')
                return (
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 shadow-sm border border-rose-500/10 select-none ${dpColor}`}>
                    {userInitial}
                  </div>
                )
              })()}
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-butter-300 font-light font-sans truncate">Logged in as</span>
                <span className="text-sm font-medium text-butter-100 font-sans truncate" title={user?.email}>
                  {user?.email || "User profile"}
                </span>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={logout}
              className="p-2 rounded-xl text-butter-300 hover:text-rose-300 hover:bg-rose-500/10 transition-all duration-300 shrink-0"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>



      {/* Share Modal Dialog */}
      <ShareModal
        isOpen={shareSession !== null}
        onClose={() => setShareSession(null)}
        sessionId={shareSession?.id}
        sessionTitle={shareSession?.title}
      />
    </>
  )
}
