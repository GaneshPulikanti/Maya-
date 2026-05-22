import React, { useState, useEffect, useRef } from 'react'
import { api } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'
import { FileText, Upload, Trash2, BrainCircuit, ShieldAlert, Sparkles, X, ChevronRight } from 'lucide-react'

export default function DocumentHub({ isOpen, onClose }) {
  const { activeSessionId, fetchMessages } = useChat()
  const [activeTab, setActiveTab] = useState('docs') // 'docs' | 'memory'
  const [documents, setDocuments] = useState([])
  const [memories, setMemories] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [loadingMems, setLoadingMems] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [confirmClearMems, setConfirmClearMems] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  // Fetch all documents
  const fetchDocuments = async () => {
    setLoadingDocs(true)
    try {
      const response = await api.get('/api/upload/documents')
      setDocuments(response.data)
    } catch (e) {
      console.error("Failed to load documents:", e)
    } finally {
      setLoadingDocs(false)
    }
  }

  // Fetch all memories
  const fetchMemories = async () => {
    setLoadingMems(true)
    try {
      const response = await api.get('/api/memory')
      setMemories(response.data)
    } catch (e) {
      console.error("Failed to load memories:", e)
    } finally {
      setLoadingMems(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchDocuments()
      fetchMemories()
    }
  }, [isOpen])

  // Triggered when active tab changes
  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'docs') fetchDocuments()
      if (activeTab === 'memory') fetchMemories()
    }
  }, [activeTab])

  // Handle file select & upload
  const handleFileUpload = async (file) => {
    if (!file) return
    const fileNameLower = file.name.toLowerCase()
    const isImage = file.type?.startsWith('image/') || 
                    fileNameLower.endsWith('.png') || 
                    fileNameLower.endsWith('.jpg') || 
                    fileNameLower.endsWith('.jpeg') || 
                    fileNameLower.endsWith('.webp') || 
                    fileNameLower.endsWith('.gif') || 
                    fileNameLower.endsWith('.bmp')

    setUploading(true)
    setUploadError("")

    const formData = new FormData()
    formData.append('file', file)

    try {
      const url = isImage ? '/api/upload/image' : '/api/upload/pdf'
      
      await api.post(url, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      fetchDocuments()
    } catch (e) {
      setUploadError(e.response?.data?.detail || `Failed to process and index ${file.name}.`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const onDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const onDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const onDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isDragging) setIsDragging(true)
  }

  const onDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }

  // Delete PDF document
  const handleDeleteDoc = async (docId) => {
    try {
      await api.delete(`/api/upload/documents/${docId}`)
      setDocuments(prev => prev.filter(d => d.id !== docId))
    } catch (e) {
      alert("Failed to delete document from storage.")
    }
  }

  // Delete single memory fact
  const handleDeleteMemory = async (memoryId) => {
    try {
      await api.delete(`/api/memory/items/${memoryId}`)
      setMemories(prev => prev.filter(m => m.id !== memoryId))
    } catch (e) {
      alert("Failed to remove memory node.")
    }
  }

  // Wipe all memories
  const handleClearAllMemories = async () => {
    try {
      await api.delete('/api/memory/clear')
      setMemories([])
      setConfirmClearMems(false)
    } catch (e) {
      alert("Failed to clear memory database.")
    }
  }

  return (
    <>
      {/* Drawer Overlay */}
      {isOpen && (
        <div 
          onClick={onClose}
          className="fixed inset-0 z-30 bg-transparent transition-opacity duration-300 lg:hidden"
        />
      )}

      {/* Main Right Drawer */}
      <aside 
        className={`fixed top-0 bottom-0 right-0 z-40 w-80 lg:w-96 bg-wine-900/95 backdrop-blur-lg border-l border-rose-500/10 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Drawer Header */}
        <div className="h-16 px-6 border-b border-wine-800/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-rose-300" />
            <h2 className="text-lg font-bold font-sans text-butter-50">Maya's Mind Space</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-butter-300 hover:text-butter-100 p-1 rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Buttons Selection */}
        <div className="flex border-b border-wine-800/40 p-2 gap-2 bg-wine-950/20">
          <button
            onClick={() => setActiveTab('docs')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold tracking-wide font-sans uppercase transition-all duration-300 flex items-center justify-center gap-1.5 ${
              activeTab === 'docs'
                ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
                : 'text-butter-300 hover:text-butter-100 hover:bg-wine-800/20 border border-transparent'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Document Hub</span>
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold tracking-wide font-sans uppercase transition-all duration-300 flex items-center justify-center gap-1.5 ${
              activeTab === 'memory'
                ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
                : 'text-butter-300 hover:text-butter-100 hover:bg-wine-800/20 border border-transparent'
            }`}
          >
            <BrainCircuit className="w-3.5 h-3.5" />
            <span>Biographical Memory</span>
          </button>
        </div>

        {/* Dynamic Tab Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* TAB 1: DOCUMENT HUB */}
          {activeTab === 'docs' && (
            <div className="space-y-4 animate-bubble-entry">
              
              {/* Context Info */}
              <div className="text-xs text-butter-200 leading-relaxed font-light font-sans bg-wine-950/40 p-4 rounded-2xl border border-rose-500/10 shadow-inner">
                <Sparkles className="w-3.5 h-3.5 text-rose-300 inline mr-1.5 -mt-0.5 animate-emotional-pulse" />
                Upload documents or media (PDFs, PPTXs, CSVs, DOCXs, Images, or Code) to Maya's mind space. She will analyze, parse, and recall them dynamically in this and other chats!
              </div>

              {/* Universal File Dropzone */}
              <div 
                onDragOver={onDragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-500 flex flex-col items-center justify-center group overflow-hidden ${
                  isDragging 
                    ? 'border-rose-300 bg-rose-500/10 shadow-[0_0_20px_rgba(158, 2, 50, 0.2)] scale-[1.02]' 
                    : 'border-rose-500/20 hover:border-rose-500/40 bg-wine-950/40 hover:bg-wine-950/60 hover:shadow-[0_0_15px_rgba(158, 2, 50, 0.05)]'
                }`}
              >
                {/* Visual Glow Effect */}
                <div className={`absolute inset-0 bg-gradient-to-br from-rose-500/5 to-transparent transition-opacity duration-500 pointer-events-none ${
                  isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`} />
                
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  className="hidden" 
                  accept="*"
                />
                
                <div className={`w-12 h-12 rounded-full flex items-center justify-center border mb-4 transition-all duration-500 ${
                  isDragging 
                    ? 'bg-rose-500/20 border-rose-300 scale-110 shadow-[0_0_10px_rgba(158, 2, 50, 0.3)]' 
                    : 'bg-rose-500/10 border-rose-500/20 group-hover:scale-105 group-hover:bg-rose-500/15 group-hover:border-rose-500/30'
                }`}>
                  {uploading ? (
                    <span className="w-5 h-5 border-2 border-rose-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Upload className={`w-5 h-5 text-rose-300 transition-transform duration-500 ${
                      isDragging ? 'translate-y-[-2px] animate-bounce' : 'group-hover:translate-y-[-1px]'
                    }`} />
                  )}
                </div>

                <span className="text-sm font-semibold text-butter-100 font-sans block mb-1.5 transition-colors duration-300">
                  {uploading 
                    ? "Indexing and analyzing content..." 
                    : isDragging 
                      ? "Drop your file here to upload!" 
                      : "Drag & Drop any file here"
                  }
                </span>
                <span className="text-xs text-butter-300 font-light font-sans transition-colors duration-300">
                  {uploading 
                    ? "Running neural semantic models..." 
                    : "or click to search files (PPTs, CSVs, PDFs, PNGs, etc.)"
                  }
                </span>
              </div>

              {uploadError && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-rose-300 text-xs animate-bubble-entry">
                  {uploadError}
                </div>
              )}

              {/* PDF Documents List */}
              <div className="space-y-2 select-none">
                <h3 className="text-xs font-bold uppercase tracking-wider text-butter-300 font-sans mb-3">Indexed Collections</h3>
                
                {loadingDocs && documents.length === 0 ? (
                  <div className="text-center py-6 text-butter-300 text-sm">
                    <span className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin inline-block mr-2" />
                    Loading index...
                  </div>
                ) : documents.length === 0 ? (
                  <div className="text-center py-8 text-butter-300 text-xs font-light italic bg-wine-950/10 rounded-xl border border-rose-500/5">
                    No indexed documents present.
                  </div>
                ) : (
                  documents.map((doc) => (
                    <div 
                      key={doc.id}
                      className="group bg-wine-900 border border-rose-500/10 hover:border-rose-500/25 p-3 rounded-xl flex items-center justify-between gap-3 transition-all duration-300"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-rose-300 shrink-0" />
                        <span className="text-sm text-butter-100 font-sans truncate" title={doc.filename}>
                          {doc.filename}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="p-1.5 rounded-lg text-butter-300 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                        title="Remove Document Index"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

            </div>
          )}

          {/* TAB 2: BIOGRAPHICAL MEMORY */}
          {activeTab === 'memory' && (
            <div className="space-y-5 animate-bubble-entry">
              
              {/* Context Info */}
              <div className="text-xs text-butter-300 leading-relaxed font-light font-sans bg-wine-950/30 p-3 rounded-xl border border-rose-500/5">
                <Sparkles className="w-3.5 h-3.5 text-rose-300 inline mr-1 -mt-0.5 animate-emotional-pulse" />
                As you chat, Maya mines important biographical details about you to maintain an ongoing context. Below is her long-term record.
              </div>

              {/* Memory Fact Capsules List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-butter-300 font-sans">Active Facts</h3>
                  <span className="text-xs text-rose-300 font-sans font-medium px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded-full">
                    {memories.length} Nodes
                  </span>
                </div>

                {loadingMems && memories.length === 0 ? (
                  <div className="text-center py-6 text-butter-300 text-sm">
                    <span className="w-4 h-4 border-2 border-rose-500 border-t-transparent rounded-full animate-spin inline-block mr-2" />
                    Connecting...
                  </div>
                ) : memories.length === 0 ? (
                  <div className="text-center py-8 text-butter-300 text-xs font-light italic bg-wine-950/10 rounded-xl border border-rose-500/5">
                    Maya hasn't recorded memories yet. Speak to her!
                  </div>
                ) : (
                  <div className="space-y-2">
                    {memories.map((mem) => (
                      <div 
                        key={mem.id}
                        className="bg-wine-900 border border-rose-500/10 p-3 rounded-xl flex items-start justify-between gap-3 text-xs leading-relaxed font-sans"
                      >
                        <span className="text-butter-100 flex-1">{mem.text}</span>
                        <button
                          onClick={() => handleDeleteMemory(mem.id)}
                          className="text-butter-300 hover:text-rose-300 p-0.5 rounded transition-colors shrink-0"
                          title="Purge Memory Item"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Clear All Database Action */}
              {memories.length > 0 && (
                <div className="pt-4 border-t border-wine-800/40">
                  {confirmClearMems ? (
                    <div className="bg-rose-500/15 border border-rose-500/30 rounded-xl p-3.5 space-y-3 animate-bubble-entry">
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                        <p className="text-xs text-butter-100 font-sans font-light leading-relaxed">
                          <strong>Warning:</strong> Wiping Maya's memory completely deletes her understanding of you. She will not remember your details or past sessions.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleClearAllMemories}
                          className="flex-1 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-sans text-xs font-semibold transition-colors"
                        >
                          Wipe Memory
                        </button>
                        <button
                          onClick={() => setConfirmClearMems(false)}
                          className="flex-1 py-1.5 rounded-lg bg-wine-800 hover:bg-wine-700 text-butter-200 font-sans text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmClearMems(true)}
                      className="w-full py-2.5 rounded-xl border border-rose-500/25 hover:bg-rose-500/5 text-rose-300 hover:text-rose-200 font-sans text-xs font-medium transition-all duration-300 flex items-center justify-center gap-2"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Reset AI Memory & Intimacy</span>
                    </button>
                  )}
                </div>
              )}

            </div>
          )}

        </div>
      </aside>
    </>
  )
}
