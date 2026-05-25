import React, { useState, useEffect } from 'react'
import { App as CapApp } from '@capacitor/app'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ChatProvider, useChat } from './context/ChatContext'
import Auth from './pages/Auth'
import Sidebar from './components/Sidebar'
import ChatWindow from './components/ChatWindow'
import DocumentHub from './components/DocumentHub'
import SharedChatView from './components/SharedChatView'
import SearchModal from './components/SearchModal'
import { Heart } from 'lucide-react'

const DashboardContent = ({ sidebarOpen, setSidebarOpen, docsOpen, setDocsOpen }) => {
  const { showSharedViewOnly } = useChat()
  const pathParts = window.location.pathname.split('/')
  const isSharedOrGroup = pathParts[1] === 'share' || pathParts[1] === 'group'
  const sharedSessionId = isSharedOrGroup && pathParts[2] ? pathParts[2] : null

  if (showSharedViewOnly && sharedSessionId) {
    return (
      <SharedChatView 
        sessionId={sharedSessionId} 
        onBackToApp={() => {
          window.history.pushState({}, '', '/')
          window.location.reload()
        }} 
      />
    )
  }

  return (
    <div className="h-full flex relative overflow-hidden bg-wine-950">
      {/* Collapsible Left Sidebar */}
      <Sidebar 
        isOpen={sidebarOpen} 
        toggleSidebar={() => setSidebarOpen(!sidebarOpen)} 
      />

      {/* Central Chat Panel Viewport with dynamic transition sliding */}
      <div className={`flex-1 min-w-0 h-full flex flex-col overflow-hidden transition-all duration-300 ${sidebarOpen ? 'lg:pl-72 pl-0' : 'pl-0'} ${docsOpen ? 'lg:pr-80 xl:pr-96 pr-0' : 'pr-0'}`}>
        <ChatWindow 
          sidebarOpen={sidebarOpen}
          toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          toggleDocs={() => setDocsOpen(true)}
        />
      </div>

      {/* Collapsible Right Document & Memory Panel Drawer */}
      <DocumentHub 
        isOpen={docsOpen} 
        onClose={() => setDocsOpen(false)} 
      />

      {/* Global Spotlight Search Modal Palette */}
      <SearchModal />
    </div>
  )
}

// Main Dashboard coordinator that lays out Sidebar, Chat, and Document drawers
const Dashboard = () => {
  // Load preferences from localStorage if they exist, otherwise default to closed
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebar_collapsed_pref')
    return saved !== null ? JSON.parse(saved) : false
  })
  const [docsOpen, setDocsOpen] = useState(() => {
    const saved = localStorage.getItem('docs_collapsed_pref')
    return saved !== null ? JSON.parse(saved) : false
  })

  // Persist layout preferences in localStorage when toggled
  useEffect(() => {
    localStorage.setItem('sidebar_collapsed_pref', JSON.stringify(sidebarOpen))
  }, [sidebarOpen])

  useEffect(() => {
    localStorage.setItem('docs_collapsed_pref', JSON.stringify(docsOpen))
  }, [docsOpen])

  return (
    <ChatProvider>
      <DashboardContent 
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        docsOpen={docsOpen}
        setDocsOpen={setDocsOpen}
      />
    </ChatProvider>
  )
}

// Router switcher based on active JWT Authentication states
const AppContent = () => {
  const { user, loading } = useAuth()
  const [showAuthForShared, setShowAuthForShared] = useState(false)

  useEffect(() => {
    let deepLinkListener;
    const initDeepLinks = async () => {
      try {
        deepLinkListener = await CapApp.addListener('appUrlOpen', data => {
          console.log('App opened with URL:', data.url)
          
          let rawPath = ""
          if (data.url.includes("://")) {
            rawPath = data.url.split("://")[1] || ""
          } else {
            try {
              const urlObj = new URL(data.url)
              rawPath = urlObj.pathname.slice(1)
            } catch (e) {
              const matches = data.url.match(/vercel\.app\/(.*)/)
              if (matches) rawPath = matches[1]
            }
          }
          
          const parts = rawPath.replace(/^\/+/, '').split('/')
          const pathType = parts[0]
          const sessionId = parts[1]
          
          if ((pathType === 'share' || pathType === 'group') && sessionId) {
            window.history.pushState({}, '', `/${pathType}/${sessionId}`)
            window.location.reload()
          }
        })
      } catch (err) {
        console.warn("Capacitor App listener not available:", err)
      }
    }
    
    initDeepLinks()
    return () => {
      if (deepLinkListener && typeof deepLinkListener.remove === 'function') {
        deepLinkListener.remove()
      }
    }
  }, [])

  // Intercept shared link URL path directly from the browser window location
  const pathParts = window.location.pathname.split('/')
  const isSharedPath = (pathParts[1] === 'share' || pathParts[1] === 'group') && pathParts[2]

  // Full-screen loading loader
  if (loading) {
    return (
      <div className="h-full w-full bg-wine-950 flex flex-col items-center justify-center select-none">
        <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/30 mb-4 animate-emotional-pulse">
          <Heart className="w-8 h-8 text-rose-300 fill-transparent" />
        </div>
        <span className="text-sm font-sans tracking-wide text-butter-300 font-light">
          Entering Maya's Sanctuary...
        </span>
      </div>
    )
  }

  if (isSharedPath && !user && !showAuthForShared) {
    return (
      <SharedChatView 
        sessionId={pathParts[2]} 
        onBackToApp={() => {
          setShowAuthForShared(true)
        }} 
      />
    )
  }

  // Switch between Auth page and Dashboard
  return user ? <Dashboard /> : <Auth />
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

