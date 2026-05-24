import React, { useState, useRef, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { api } from '../context/AuthContext'

// Capacitor plugin for Android audio recording (only loaded if available)
let AudioRecorder = null
let isCapacitorAvailable = false

// Attempt to import Capacitor plugin if in native environment
if (typeof window !== 'undefined' && window.Capacitor) {
  try {
    isCapacitorAvailable = true
    console.log("AudioRecorder plugin registered")
    console.log("Capacitor AudioRecorder ACTIVE") // 👈 ADD HERE

    const { registerPlugin } = window.Capacitor
    AudioRecorder = registerPlugin('AudioRecorder')
  } catch (err) {
    console.warn('Capacitor audio plugin not available, falling back to MediaRecorder API')
  }
}

export default function VoiceRecorder({ onTranscriptionComplete, disabled }) {
  const [isRecording, setIsRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [recordingMethod, setRecordingMethod] = useState('mediarecorder') // 'mediarecorder' or 'capacitor'

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const timerRef = useRef(null)
  const isAndroidRef = useRef(typeof window !== 'undefined' && /android/i.test(navigator.userAgent))

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const startRecording = async () => {
    console.log("START RECORDING CALLED")
    console.log("Plugin available:", isCapacitorAvailable)
    console.log("AudioRecorder:", AudioRecorder)
    audioChunksRef.current = []
    setRecordingTime(0)

    // Try Capacitor plugin first on Android devices
    if (AudioRecorder && isCapacitorAvailable) {
      try {
        console.log("Using native Capacitor recorder")
        await AudioRecorder.startRecording()
        setRecordingMethod('capacitor')
        setIsRecording(true)

        // Start recording timer
        timerRef.current = setInterval(() => {
          setRecordingTime((prev) => prev + 1)
        }, 1000)
        return
      } catch (err) {
        console.warn('Capacitor recording failed, falling back to MediaRecorder:', err)
        // Continue to MediaRecorder fallback
      }
    }

    // Fallback to MediaRecorder API (works on web and some Android WebViews)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // Determine supported mime type
      let options = {}
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options = { mimeType: 'audio/webm;codecs=opus' }
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' }
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        options = { mimeType: 'audio/ogg;codecs=opus' }
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' }
      }

      const mediaRecorder = new MediaRecorder(stream, options)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' })

        // Stop all audio tracks to release microphone
        stream.getTracks().forEach((track) => track.stop())

        await uploadAudio(audioBlob)
      }

      mediaRecorder.start()
      setRecordingMethod('mediarecorder')
      setIsRecording(true)

      // Start recording timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1)
      }, 1000)

    } catch (err) {
      console.error('Microphone access denied or error:', err)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone access is restricted by your browser. If you're on a mobile device, you must access this app via 'https://' or 'localhost' for the microphone to work.")
      } else {
        alert('Microphone access denied. Please check your browser permissions and allow microphone access.')
      }
    }
  }

  const stopRecording = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (recordingMethod === 'capacitor' && AudioRecorder) {
      try {
        const result = await AudioRecorder.stopRecording()
        setIsRecording(false)

        // Capacitor returns base64 audio data
        if (result && result.value) {
          const binaryString = atob(result.value)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          const blob = new Blob([bytes], { type: 'audio/wav' })
          await uploadAudio(blob)
        }
      } catch (err) {
        console.error('Capacitor recording stop error:', err)
        setIsRecording(false)
      }
    } else if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const uploadAudio = async (blob) => {
    const formData = new FormData()
    // Determine the exact correct file extension based on the actual recorded mime type
    let extension = 'webm'
    if (blob.type.includes('webm')) {
      extension = 'webm'
    } else if (blob.type.includes('mp4') || blob.type.includes('m4a') || blob.type.includes('aac')) {
      extension = 'm4a'
    } else if (blob.type.includes('ogg')) {
      extension = 'ogg'
    } else if (blob.type.includes('wav')) {
      extension = 'wav'
    } else if (blob.type.includes('mpeg')) {
      extension = 'mp3'
    }

    formData.append('file', blob, `voice.${extension}`)

    setTranscribing(true)
    try {
      const response = await api.post('/api/voice/transcribe', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      if (response.data?.text) {
        onTranscriptionComplete(response.data.text)
      }
    } catch (err) {
      console.error('Failed to transcribe audio:', err)
      alert(err.response?.data?.detail || 'Failed to transcribe audio. Please try again.')
    } finally {
      setTranscribing(false)
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  return (
    <div className="relative flex items-center justify-center shrink-0">
      {isRecording && (
        <span className="absolute -top-12 left-1/2 -translate-x-1/2 bg-wine-950 border border-rose-500/30 text-rose-300 text-xs px-2.5 py-1 rounded-full font-mono flex items-center gap-1.5 shadow-lg select-none whitespace-nowrap z-50 animate-bounce">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
          <span>Recording: {formatTime(recordingTime)}</span>
        </span>
      )}

      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled || transcribing}
        className={`p-2 sm:p-3 rounded-xl border transition-all duration-300 disabled:opacity-40 disabled:pointer-events-none hover:shadow-lg flex items-center justify-center relative ${isRecording
          ? 'border-rose-500 bg-rose-500/20 text-rose-200 animate-pulse'
          : 'border-rose-500/20 hover:border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10 text-rose-300 hover:text-rose-200'
          }`}
        title={isRecording ? "Stop recording and send" : "Record voice input"}
      >
        {transcribing ? (
          <Loader2 className="w-4 h-4 sm:w-4.5 sm:h-4.5 animate-spin text-rose-300" />
        ) : isRecording ? (
          <Square className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-rose-200 fill-rose-200" />
        ) : (
          <Mic className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
        )}
      </button>
    </div>
  )
}
