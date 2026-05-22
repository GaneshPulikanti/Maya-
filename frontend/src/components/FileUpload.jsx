import React, { useRef, useState } from 'react'
import { Paperclip, Loader2 } from 'lucide-react'
import { api } from '../context/AuthContext'

export default function FileUpload({ onUploadStart, onUploadComplete, onUploadError, disabled }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const handleButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    setUploading(true)
    if (onUploadStart) onUploadStart()
    
    try {
      const response = await api.post('/api/vision/analyze', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      if (response.data?.explanation) {
        onUploadComplete({
          explanation: response.data.explanation,
          imageUrl: response.data.image_url,
          fileType: response.data.file_type || 'other',
          fileName: response.data.file_name || file.name,
          previewUrl: response.data.file_type === 'image' ? URL.createObjectURL(file) : null
        })
      }
    } catch (err) {
      console.error('Failed to analyze file:', err)
      if (onUploadError) onUploadError()
      alert(err.response?.data?.detail || 'Failed to analyze file. Please try again.')
    } finally {
      setUploading(false)
      // Reset file input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="relative flex items-center justify-center shrink-0">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*, .pdf, .csv, .txt, .docx, .pptx, .xlsx, .json, .md, .log"
        className="hidden"
      />
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={disabled || uploading}
        className="p-2 sm:p-3 rounded-xl border border-rose-500/20 hover:border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 text-rose-300 hover:text-rose-200 transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none hover:shadow-lg flex items-center justify-center relative"
        title="Upload and analyze files (PDF, CSV, Doc, Image, etc.)"
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 sm:w-4.5 sm:h-4.5 animate-spin text-rose-300" />
        ) : (
          <Paperclip className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
        )}
      </button>
    </div>
  )
}
