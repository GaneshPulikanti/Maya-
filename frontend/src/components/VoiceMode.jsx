import React, { useState, useRef, useEffect } from 'react'
import { X, Loader2, Heart, AlertCircle } from 'lucide-react'
import { api } from '../context/AuthContext'
import { useChat } from '../context/ChatContext'

// ─── Capacitor Audio Plugin (Android native recording fallback) ──────────────
let AudioRecorder = null
let isCapacitorAvailable = false

if (typeof window !== 'undefined' && window.Capacitor) {
  try {
    isCapacitorAvailable = true
    const { registerPlugin } = window.Capacitor
    console.log("Capacitor available:", window.Capacitor)
    console.log("Registering AudioRecorder plugin")
    AudioRecorder = registerPlugin('AudioRecorder')
  } catch (err) {
    console.warn('Capacitor audio plugin not available')
  }
}

// ─── Clean markdown/code out of text before speaking ────────────────────────
function toSpeechText(text) {
  return (text || '')
    .replace(/```[\s\S]*?```/g, 'a code block')
    .replace(/`[^`]+`/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(stopped)\*$/, '')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/[|\-]{3,}/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 380)
}

// ─── TTS: Web Speech API fires immediately, Groq Orpheus upgrades if faster ──
function speakText(rawText, onDone, onError) {
  const text = toSpeechText(rawText)

  if (!text) {
    onDone?.()
    return () => { }
  }

  let finished = false
  let activeAudio = null

  const done = () => {
    if (finished) return
    finished = true
    onDone?.()
  }

  // Pre-create and unlock the audio element synchronously
  const audio = document.createElement('audio')
  audio.style.display = 'none'
  audio.setAttribute("playsinline", "true")
  document.body.appendChild(audio)
  activeAudio = audio

  const cleanup = () => {
    try {
      if (document.body.contains(audio)) {
        document.body.removeChild(audio)
      }
    } catch (e) {}
  }

  audio.onended = () => {
    cleanup()
    activeAudio = null
    done()
  }

  audio.onerror = (e) => {
    console.error("Orpheus audio playback error:", e)
    cleanup()
    activeAudio = null
    done()
  }

  const token = localStorage.getItem('token') || ''
  const baseUrl = import.meta.env.VITE_API_URL || api.defaults.baseURL || window.location.origin
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const url = `${cleanBase}/api/voice/speak?text=${encodeURIComponent(text)}&voice=diana&token=${token}`

  audio.src = url
  audio.play().catch((err) => {
    console.error("Orpheus audio play failed:", err)
    cleanup()
    activeAudio = null
    done()
  })

  // Return clean cancellation function
  return () => {
    finished = true
    if (activeAudio) {
      try {
        activeAudio.pause()
        activeAudio.src = ''
        if (document.body.contains(activeAudio)) {
          document.body.removeChild(activeAudio)
        }
      } catch { }
      activeAudio = null
    }
  }
}

// ─── Phase constants ─────────────────────────────────────────────────────────
const PHASE = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
}

const COLORS = {
  [PHASE.IDLE]: '#9e0232', // Cerise - Primary Accent
  [PHASE.LISTENING]: '#FC89C3', // Persian Pink - Soft Pink Accent
  [PHASE.PROCESSING]: '#FAC6E5', // Classic Rose - Cream Pink Accent
  [PHASE.SPEAKING]: '#9e0232', // Pink Raspberry replacement (vibrant pink)
}

const VocalIconLarge = ({ isMoving = false, color = "#9e0232" }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 36, width: 36 }}>
      <span className={isMoving ? 'animate-vocal-large-1' : ''} style={{ width: 3.5, borderRadius: 9999, background: color, height: isMoving ? undefined : '10px', transition: 'height 0.2s' }} />
      <span className={isMoving ? 'animate-vocal-large-2' : ''} style={{ width: 3.5, borderRadius: 9999, background: color, height: isMoving ? undefined : '22px', transition: 'height 0.2s' }} />
      <span className={isMoving ? 'animate-vocal-large-3' : ''} style={{ width: 3.5, borderRadius: 9999, background: color, height: isMoving ? undefined : '16px', transition: 'height 0.2s' }} />
      <span className={isMoving ? 'animate-vocal-large-4' : ''} style={{ width: 3.5, borderRadius: 9999, background: color, height: isMoving ? undefined : '24px', transition: 'height 0.2s' }} />
      <span className={isMoving ? 'animate-vocal-large-5' : ''} style={{ width: 3.5, borderRadius: 9999, background: color, height: isMoving ? undefined : '10px', transition: 'height 0.2s' }} />
    </div>
  )
}

// ─── VoiceMode component ─────────────────────────────────────────────────────
export default function VoiceMode({ isOpen, onClose }) {
  const { sendMessage, messages, isStreaming } = useChat()

  const [phase, setPhase] = useState(PHASE.IDLE)
  const [transcript, setTrans] = useState('')
  const [mayaReply, setReply] = useState('')
  const [recSecs, setRecSecs] = useState(0)
  const [error, setError] = useState('')

  // Internal refs — never stale in async callbacks
  const phaseRef = useRef(PHASE.IDLE)
  const waitingRef = useRef(false)       // true after sendMessage is called
  const prevStreamingRef = useRef(false)       // track isStreaming transitions
  const mountedRef = useRef(true)
  const mediaRecRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const speakCancelRef = useRef(null)
  const abortRecRef = useRef(false) // Track intentional aborts
  const isOpenRef = useRef(isOpen)
  const isAndroidRef = useRef(typeof window !== 'undefined' && (/android/i.test(navigator.userAgent) || (window.Capacitor && window.Capacitor.getPlatform() === 'android')))
  const recordingMethodRef = useRef('mediarecorder')
  const vadIntervalRef = useRef(null)
  const audioContextRef = useRef(null)
  const vadSourceRef = useRef(null)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

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

  // Keep phaseRef in sync (sync update, not async like useEffect)
  const setPhaseSync = (p) => { phaseRef.current = p; setPhase(p) }

  // Mounted flag
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; stopEverything() }
  }, [])

  // Open/close reset
  useEffect(() => {
    if (isOpen) {
      prevStreamingRef.current = false
      waitingRef.current = false
      unlockAudio()
      startRec()
    } else {
      stopEverything()
      setPhaseSync(PHASE.IDLE)
      setTrans(''); setReply(''); setError('')
      waitingRef.current = false
    }
  }, [isOpen])

  // ── KEY: detect isStreaming false edge (true → false) ──────────────────────
  useEffect(() => {
    if (!isOpen) return

    const justFinished = prevStreamingRef.current === true && isStreaming === false
    prevStreamingRef.current = isStreaming

    if (!justFinished) return          // Not the transition we care about
    if (!waitingRef.current) return    // We didn't trigger this stream

    waitingRef.current = false

    // Find the latest assistant message (last one in the array)
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant?.content?.trim()) {
      setPhaseSync(PHASE.IDLE)
      return
    }

    const fullText = toSpeechText(lastAssistant.content)
    setReply(fullText)
    setPhaseSync(PHASE.SPEAKING)

    // Store the speech stop cancel function on ref
    speakCancelRef.current = speakText(lastAssistant.content, () => {
      if (!mountedRef.current) return
      speakCancelRef.current = null
      setTrans('')
      setReply('')

      // CHATGPT VOICE STYLE: Automatically transition back to listening for natural, hands-free conversation loop!
      startRec()
    }, (errMsg) => {
      if (mountedRef.current) {
        setError(errMsg)
      }
    })
  }, [isStreaming, isOpen])
  // Note: intentionally omit `messages` from deps — we only care about isStreaming edge

  const stopEverything = () => {
    abortRecRef.current = true // Mark as intentional abort
    if (speakCancelRef.current) {
      try { speakCancelRef.current() } catch { }
      speakCancelRef.current = null
    }
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }
    if (vadSourceRef.current) {
      try { vadSourceRef.current.disconnect() } catch (e) {}
      vadSourceRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close() } catch (e) {}
      audioContextRef.current = null
    }
    if (recordingMethodRef.current === 'capacitor' && AudioRecorder) {
      try {
        AudioRecorder.stopRecording().catch(err => {
          console.warn('Failed to stop Capacitor recorder on cleanup:', err)
        })
      } catch (err) {
        console.warn('Failed to stop Capacitor recorder on cleanup:', err)
      }
    }
    if (mediaRecRef.current?.state === 'recording') {
      try { mediaRecRef.current.stop() } catch { }
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    window.speechSynthesis?.cancel()
    setRecSecs(0)
  }

  // ── Start recording ────────────────────────────────────────────────────────
  const startRec = async () => {
    setError('')
    chunksRef.current = []

    let stream = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
    } catch (err) {
      console.warn("navigator.mediaDevices.getUserMedia failed:", err)
    }

    // If we obtained the stream, set up the VAD and record with MediaRecorder
    if (stream) {
      try {
        let opts = {}
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          opts = { mimeType: 'audio/webm;codecs=opus' }
        } else if (MediaRecorder.isTypeSupported('audio/webm')) {
          opts = { mimeType: 'audio/webm' }
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          opts = { mimeType: 'audio/ogg;codecs=opus' }
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          opts = { mimeType: 'audio/mp4' }
        }

        const rec = new MediaRecorder(stream, opts)
        mediaRecRef.current = rec
        recordingMethodRef.current = 'mediarecorder'

        rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        rec.onstop = async () => {
          // Clean up stream tracks
          streamRef.current?.getTracks().forEach(t => t.stop())
          streamRef.current = null
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
          
          // Clean up VAD
          if (vadIntervalRef.current) {
            clearInterval(vadIntervalRef.current)
            vadIntervalRef.current = null
          }
          if (vadSourceRef.current) {
            try { vadSourceRef.current.disconnect() } catch (e) {}
            vadSourceRef.current = null
          }
          if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            try { audioContextRef.current.close() } catch (e) {}
            audioContextRef.current = null
          }

          if (mountedRef.current && !abortRecRef.current) {
            await transcribeAndSend()
          }
          abortRecRef.current = false // Reset for next time
        }

        // Start Silence Detection VAD using Web Audio API
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)()
          audioContextRef.current = audioContext
          
          const source = audioContext.createMediaStreamSource(stream)
          vadSourceRef.current = source
          
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 512
          source.connect(analyser)
          
          const bufferLength = analyser.fftSize
          const dataArray = new Uint8Array(bufferLength)
          
          let lastSoundTime = Date.now()
          const silenceThreshold = 8 // Adjust amplitude threshold (0-128 range)
          const silenceDuration = 1800 // 1.8 seconds of silence before auto-send
          
          const checkSilence = () => {
            if (phaseRef.current !== PHASE.LISTENING) return
            
            analyser.getByteTimeDomainData(dataArray)
            
            let maxVal = 0
            for (let i = 0; i < bufferLength; i++) {
              const val = Math.abs(dataArray[i] - 128)
              if (val > maxVal) maxVal = val
            }
            
            if (maxVal > silenceThreshold) {
              lastSoundTime = Date.now()
            } else {
              const elapsed = Date.now() - lastSoundTime
              if (elapsed > silenceDuration) {
                // Silence detected! Stop recording automatically and send
                if (vadIntervalRef.current) {
                  clearInterval(vadIntervalRef.current)
                  vadIntervalRef.current = null
                }
                stopRec()
              }
            }
          }
          
          vadIntervalRef.current = setInterval(checkSilence, 100)
        } catch (err) {
          console.warn("Failed to initialize VAD silence detection:", err)
        }

        rec.start()
        setPhaseSync(PHASE.LISTENING)
        setRecSecs(0)
        timerRef.current = setInterval(() => setRecSecs(s => s + 1), 1000)
        return
      } catch (e) {
        console.error('MediaRecorder initialization failed:', e)
        // Fall back to Capacitor
      }
    }

    // Try Capacitor plugin fallback on Android devices if getUserMedia/MediaRecorder failed
    if (isAndroidRef.current && AudioRecorder && isCapacitorAvailable) {
      try {
        await AudioRecorder.startRecording()
        recordingMethodRef.current = 'capacitor'
        setPhaseSync(PHASE.LISTENING)
        setRecSecs(0)
        timerRef.current = setInterval(() => setRecSecs(s => s + 1), 1000)
        return
      } catch (err) {
        console.warn('Capacitor recording failed:', err)
      }
    }

    setError('Microphone access denied or failed to initialize recording.')
    setPhaseSync(PHASE.IDLE)
  }

  // ── Stop recording ─────────────────────────────────────────────────────────
  const stopRec = async () => {
    abortRecRef.current = false // Intentional user finish (not aborting)

    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }
    if (vadSourceRef.current) {
      try { vadSourceRef.current.disconnect() } catch (e) {}
      vadSourceRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close() } catch (e) {}
      audioContextRef.current = null
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach(t => t.stop()) } catch (e) {}
      streamRef.current = null
    }

    if (recordingMethodRef.current === 'capacitor' && AudioRecorder) {
      try {
        const result = await AudioRecorder.stopRecording()
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }

        // Capacitor returns base64 audio data
        if (result && result.value) {
          const binaryString = atob(result.value)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          const blob = new Blob([bytes], { type: 'audio/wav' })
          if (mountedRef.current && !abortRecRef.current) {
            await uploadAndTranscribe(blob)
          }
        }
      } catch (err) {
        console.error('Capacitor stop error:', err)
        setPhaseSync(PHASE.IDLE)
        setError('Failed to stop recording')
      }
    } else if (mediaRecRef.current?.state === 'recording') {
      mediaRecRef.current.stop()
    }
  }

  // ── Transcribe blob → send to Maya ─────────────────────────────────────────
  const uploadAndTranscribe = async (blob) => {
    if (!mountedRef.current) return
    setPhaseSync(PHASE.PROCESSING)

    if (blob.size < 600) {
      setError("Didn't hear anything — try speaking a little longer.")
      setPhaseSync(PHASE.IDLE)
      return
    }

    // Determine the exact correct file extension based on the actual recorded mime type
    let extension = 'wav'
    if (blob.type) {
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
    }

    const fd = new FormData()
    fd.append('file', blob, `voice.${extension}`)

    try {
      const res = await api.post('/api/voice/transcribe', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      // If user closed the modal or intentionally aborted, don't send!
      if (!isOpenRef.current || abortRecRef.current) {
        return
      }

      const spoken = res.data?.text?.trim()
      if (!spoken || spoken.length < 2) {
        setError("Didn't catch that. Speak clearly and try again.")
        setPhaseSync(PHASE.IDLE)
        return
      }

      setTrans(spoken)

      // Mark that we're waiting for the reply BEFORE calling sendMessage
      prevStreamingRef.current = false
      waitingRef.current = true

      sendMessage(spoken, true)
      // Phase stays 'processing' — the isStreaming useEffect will move to 'speaking'
    } catch (err) {
      if (!isOpenRef.current || abortRecRef.current) return;
      console.error('STT error:', err)
      setError(err?.response?.data?.detail || 'Transcription failed. Try again.')
      setPhaseSync(PHASE.IDLE)
    }
  }

  // ── Transcribe blob → send to Maya (legacy name, wraps uploadAndTranscribe) ─
  const transcribeAndSend = async () => {
    const mimeType = mediaRecRef.current?.mimeType || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    await uploadAndTranscribe(blob)
  }

  // ── Mic button click ───────────────────────────────────────────────────────
  const handleMic = () => {
    unlockAudio()
    if (phaseRef.current === PHASE.IDLE) {
      startRec()
    } else if (phaseRef.current === PHASE.LISTENING) {
      setPhaseSync(PHASE.PROCESSING) // set to processing immediately to avoid double clicks/taps
      stopRec()
    } else if (phaseRef.current === PHASE.SPEAKING) {
      // CHATGPT INTERRUPT MODE: If clicked while speaking, immediately stop speaking and start listening to user's new turn!
      if (speakCancelRef.current) {
        try { speakCancelRef.current() } catch { }
        speakCancelRef.current = null
      }
      setTrans('')
      setReply('')
      startRec()
    }
  }

  const handleClose = () => {
    stopEverything()
    waitingRef.current = false
    setPhaseSync(PHASE.IDLE)
    setTrans(''); setReply(''); setError('')
    onClose()
  }

  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const color = COLORS[phase]
  const isPulsing = phase === PHASE.LISTENING || phase === PHASE.SPEAKING

  if (!isOpen) return null

  return (
    <>
      <style>{`
        @keyframes vmRing   { 0%{transform:scale(1);opacity:.5} 100%{transform:scale(2.4);opacity:0} }
        @keyframes vmBar    { 0%,100%{transform:scaleY(.32)} 50%{transform:scaleY(1)} }
        @keyframes vmFadeIn { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes vmOrb    { 0%,100%{box-shadow:0 0 28px 6px rgba(158, 2, 50, 0.28)} 50%{box-shadow:0 0 52px 16px rgba(158, 2, 50, 0.5)} }
        @keyframes vmSpin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      <div
        onClick={e => e.target === e.currentTarget && handleClose()}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(253,228,242,.95)', // wine-950 equivalent with opacity for light theme
          backdropFilter: 'blur(22px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* ── Card ──────────────────────────────────────────────────────── */}
        <div style={{
          position: 'relative', width: '100%', maxWidth: 420, margin: '0 16px',
          background: 'linear-gradient(148deg,#FFF5FA 0%,#FDE4F2 55%,#FAC6E5 100%)', // premium soft light wine backgrounds
          border: '1px solid rgba(158,2,50,.25)', // Cerise pink tint
          borderRadius: 30, padding: '38px 28px 42px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
          boxShadow: '0 30px 72px rgba(158,2,50,.12), 0 0 48px rgba(158,2,50,.07)',
          animation: 'vmFadeIn .32s ease-out forwards',
        }}>

          {/* Close */}
          <button
            onClick={handleClose}
            aria-label="Close voice modal"
            style={{
              position: 'absolute', top: 15, right: 15,
              background: 'transparent', border: 'none',
              borderRadius: 10, padding: 7, cursor: 'pointer',
              color: '#9e0232', display: 'flex', lineHeight: 0,
            }}
          ><X size={16} color="#9e0232" /></button>

          {/* Header */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 4 }}>
              <Heart size={13} fill="#9e0232" style={{ color: '#9e0232' }} />
              <span style={{ fontSize: 17, fontWeight: 700, color: '#9e0232', fontFamily: 'sans-serif', letterSpacing: '.01em' }}>
                Voice Assistant Mode
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#9e0232', fontFamily: 'sans-serif', letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 600 }}>
              Live Conversation Loop
            </span>
          </div>

          {/* ── Orb + rings ──────────────────────────────────────────────── */}
          <div style={{ position: 'relative', width: 155, height: 155, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '6px 0' }}>
            {isPulsing && [0, 0.58, 1.16].map((d, i) => (
              <div key={i} style={{
                position: 'absolute', width: 155, height: 155, borderRadius: '50%',
                border: `2px solid ${color}`, opacity: .5,
                animation: `vmRing 1.75s ease-out ${d}s infinite`,
                pointerEvents: 'none',
              }} />
            ))}

            {/* Mic / action orb */}
            <button
              onClick={handleMic}
              disabled={phase === PHASE.PROCESSING}
              style={{
                position: 'relative',
                zIndex: 10,
                width: 98, height: 98, borderRadius: '50%', outline: 'none',
                border: `2px solid ${color}40`,
                background: phase === PHASE.LISTENING
                  ? `radial-gradient(circle,${color}48,${color}18)`
                  : phase === PHASE.SPEAKING
                    ? `radial-gradient(circle,rgba(158,2,50,.22),rgba(158,2,50,.06))`
                    : `radial-gradient(circle,rgba(158,2,50,.2),rgba(158,2,50,.06))`,
                cursor: (phase !== PHASE.PROCESSING) ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .28s',
                animation: phase === PHASE.IDLE ? 'vmOrb 3.2s ease-in-out infinite' : 'none',
              }}
            >
              {phase === PHASE.PROCESSING
                ? <Loader2 size={36} color="#FAC6E5" style={{ animation: 'vmSpin 1s linear infinite' }} />
                : <VocalIconLarge isMoving={phase === PHASE.LISTENING || phase === PHASE.SPEAKING} color={phase === PHASE.IDLE ? "#9e0232" : "#FC89C3"} />
              }
            </button>
          </div>

          {/* Sound wave bars */}
          {isPulsing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28 }}>
              {[.28, .6, .98, .68, .38, .82, .5, .88, .32, .65, .48, .36].map((h, i) => (
                <div key={i} style={{
                  width: 3, borderRadius: 3,
                  background: phase === PHASE.LISTENING ? '#FC89C3' : '#9e0232',
                  height: `${h * 28}px`,
                  animation: `vmBar ${.52 + i * .08}s ease-in-out ${i * .06}s infinite alternate`,
                  opacity: .85,
                }} />
              ))}
            </div>
          )}

          {/* Phase label */}
          <p style={{
            fontSize: 14, fontWeight: 700, color: '#9e0232', fontFamily: 'sans-serif',
            margin: 0, textAlign: 'center', minHeight: 20, transition: 'color .3s',
            textShadow: '0 1px 6px #fff8, 0 0px 1px #fff8',
          }}>
            {phase === PHASE.IDLE && 'Tap the mic to start conversation'}
            {phase === PHASE.LISTENING && `Listening...  ${recSecs > 0 ? fmt(recSecs) : ''}`}
            {phase === PHASE.PROCESSING && 'Maya is thinking...'}
            {phase === PHASE.SPEAKING && 'Maya is speaking (tap to interrupt)'}
          </p>

          {/* You said bubble */}
          {transcript && (phase === PHASE.PROCESSING || phase === PHASE.SPEAKING) && (
            <div style={{
              background: 'rgba(158,2,50,.07)', border: '1px solid rgba(158,2,50,.18)',
              borderRadius: 14, padding: '9px 15px',
              width: '100%', maxWidth: 350, boxSizing: 'border-box',
              maxHeight: '120px', overflowY: 'auto'
            }}>
              <span style={{ fontSize: 10, color: 'rgba(158,2,50,.7)', textTransform: 'uppercase', letterSpacing: '.07em', fontFamily: 'sans-serif', display: 'block', marginBottom: 3 }}>
                You said
              </span>
              <p style={{ fontSize: 13, color: '#9e0232', fontFamily: 'sans-serif', margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
                "{transcript}"
              </p>
            </div>
          )}

          {/* Maya says bubble */}
          {mayaReply && phase === PHASE.SPEAKING && (
            <div style={{
              background: 'rgba(250,198,229,.07)', border: '1px solid rgba(250,198,229,.18)',
              borderRadius: 14, padding: '9px 15px',
              width: '100%', maxWidth: 350, boxSizing: 'border-box',
              maxHeight: '120px', overflowY: 'auto'
            }}>
              <span style={{ fontSize: 10, color: 'rgba(250,198,229,.85)', textTransform: 'uppercase', letterSpacing: '.07em', fontFamily: 'sans-serif', display: 'block', marginBottom: 3 }}>
                Maya says
              </span>
              <p style={{ fontSize: 13, color: '#9e0232', fontFamily: 'sans-serif', margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
                "{mayaReply}"
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)',
              borderRadius: 11, padding: '8px 13px',
              width: '100%', maxWidth: 350, boxSizing: 'border-box',
            }}>
              <AlertCircle size={14} color="#f87171" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#f87171', fontFamily: 'sans-serif', flex: 1 }}>{error}</span>
              <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', padding: 0, lineHeight: 0 }}>
                <X size={12} />
              </button>
            </div>
          )}

          {/* Instruction hint */}
          <p style={{ fontSize: 11, color: 'rgba(250,198,229,.28)', fontFamily: 'sans-serif', margin: 0, textAlign: 'center' }}>
            {phase === PHASE.IDLE && 'Tap mic → speak → tap again when done'}
            {phase === PHASE.LISTENING && 'Speak, then tap the mic button to get the answer'}
            {phase === PHASE.PROCESSING && 'Processing your voice response...'}
            {phase === PHASE.SPEAKING && 'Listening will start automatically when she finished speaking'}
          </p>
        </div>
      </div>
    </>
  )
}
