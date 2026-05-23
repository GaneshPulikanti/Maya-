# Android Voice System Setup Guide

## Overview
The Maya chatbot now includes a production-ready Android-compatible voice system using:
- **Capacitor Audio Recorder** for native Android audio recording
- **Groq Whisper API** for speech-to-text transcription
- **Groq Orpheus TTS** for text-to-speech synthesis
- **MediaRecorder API fallback** for web browsers

## Installation & Setup

### 1. Install Capacitor Audio Plugin

```bash
cd frontend

# Install the audio recorder plugin
npm install @capacitor-community/audio-recorder
npx cap sync android
```

### 2. Android Permissions

The plugin automatically adds required permissions. Ensure `AndroidManifest.xml` includes:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
```

### 3. Environment Variables

Ensure your backend has Groq API key configured:

```bash
# backend/.env
GROQ_API_KEY=your_groq_api_key_here
```

### 4. Build & Deploy APK

```bash
# Frontend: Build for production
cd frontend
npm run build

# Capacitor: Sync files to Android project
npx cap sync android

# Android Studio: Build and deploy
cd android
./gradlew assembleDebug  # or assembleRelease
```

## How It Works

### Voice Recording Flow
1. User taps microphone button in VoiceMode
2. System attempts native Capacitor recording on Android
3. Falls back to MediaRecorder API if Capacitor unavailable
4. Audio is recorded as WAV format
5. Recording is sent to backend `/api/voice/transcribe` endpoint

### Transcription Pipeline
1. Backend receives audio file
2. Groq Whisper API transcribes audio to text
3. Transcribed text returned to frontend
4. Text automatically inserted into chat input

### Text-to-Speech Pipeline
1. Backend AI generates response text
2. Frontend calls `/api/voice/speak` endpoint
3. Groq Orpheus generates high-quality speech audio
4. Audio played back to user with female voice preference

## Frontend Components Modified

### VoiceRecorder.jsx
- Added Capacitor plugin detection
- Dual recording method support (Capacitor + MediaRecorder)
- Android device detection
- Graceful fallback handling

### VoiceMode.jsx
- Added Capacitor integration for native recording
- Same dual-method support as VoiceRecorder
- Automatic speech recognition → text insertion
- Natural conversation loop (voice → text → response → speech)

## Backend Endpoints

### POST /api/voice/transcribe
Transcribes audio file using Groq Whisper

**Request:**
```
Content-Type: multipart/form-data
file: <audio file>
```

**Response:**
```json
{
  "text": "transcribed text here"
}
```

### POST /api/voice/speak
Generates speech audio using Groq Orpheus

**Request:**
```json
{
  "text": "text to speak",
  "voice": "diana"  // female voice
}
```

**Response:**
- Binary audio/wav data

## Testing

### On Desktop Browser
1. Run `npm run dev` in frontend
2. Click voice recorder icon
3. Allow microphone permission
4. Speak into microphone
5. Text should appear in chat input

### On Android Device
1. Build APK: `npm run build && npx cap sync android`
2. Open Android Studio and deploy to device/emulator
3. Open app and navigate to chat
4. Tap voice recorder
5. Grant microphone permission popup
6. Speak into device microphone
7. Transcribed text appears in chat

## Troubleshooting

### "Microphone access denied"
- Check Android `Settings > Apps > Maya > Permissions > Microphone` is enabled
- On web, check browser microphone permissions

### "Failed to transcribe audio"
- Verify backend is running: `uvicorn app.main:app --reload`
- Check `GROQ_API_KEY` is set in backend environment
- Ensure audio file is at least 600 bytes (0.6KB)

### Recording works but transcription fails
- Check backend logs for Groq API errors
- Verify internet connection for API calls
- Try speaking more clearly/longer

### Capacitor plugin not recognized
- Ensure plugin installed: `npm install @capacitor-community/audio-recorder`
- Run `npx cap sync android` after installation
- Rebuild Android project in Android Studio

## Performance Notes

- Capacitor recording uses native Android APIs (MediaRecorder)
- WAV format used for compatibility with Groq Whisper
- Groq Whisper turbo model is fast (~2-3 seconds for transcription)
- Orpheus TTS generation varies based on text length (usually 1-5 seconds)
- Fallback to browser MediaRecorder if Capacitor unavailable ensures web compatibility

## Audio Format Support

- **Input (Recording)**: WAV (PCM audio, 16-bit, 16kHz)
- **Transcription API**: Supports WAV, MP3, OGG, WebM, MP4
- **Output (TTS)**: WAV audio

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Maya Android App                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  VoiceMode.jsx / VoiceRecorder.jsx                          │
│         ↓                                                    │
│  [Android Detection]                                        │
│         ↓                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Is Android & Capacitor Available?                   │   │
│  ├────────────┬──────────────────────┬────────────────┤   │
│  │ YES        │ FALLBACK TO           │ NO / FAILED    │   │
│  │ USE        │ MediaRecorder         │ USE            │   │
│  │ CAPACITOR  │                       │ MediaRecorder  │   │
│  └────────────┴──────────────────────┴────────────────┘   │
│         ↓                 ↓                 ↓              │
│    [WAV Audio Recording]                                   │
│         ↓                                                   │
│    Upload to /api/voice/transcribe                        │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       ↓
          ┌─────────────────────────────┐
          │   FastAPI Backend            │
          ├─────────────────────────────┤
          │  /api/voice/transcribe       │
          │         ↓                    │
          │  Groq Whisper API            │
          │  (whisper-large-v3-turbo)    │
          │         ↓                    │
          │  Return Transcribed Text     │
          └─────────────────────────────┘
                       ↓
          ┌─────────────────────────────┐
          │   Frontend Chat Integration  │
          ├─────────────────────────────┤
          │  Insert Text in Chat Input   │
          │  Send Message to Maya        │
          │         ↓                    │
          │  Receive AI Response         │
          │         ↓                    │
          │  /api/voice/speak            │
          │         ↓                    │
          │  Groq Orpheus TTS            │
          │         ↓                    │
          │  Play Speech Audio           │
          └─────────────────────────────┘
```

## Migration from Browser Speech APIs

The system no longer uses:
- ❌ `window.SpeechRecognition`
- ❌ `window.webkitSpeechRecognition`
- ❌ Browser-based speech synthesis limitations

Replaced with:
- ✅ Native Android audio recording (Capacitor)
- ✅ Groq Whisper transcription (enterprise-grade)
- ✅ Groq Orpheus text-to-speech (high-quality female voice)
- ✅ MediaRecorder fallback for web browsers

## Future Improvements

- [ ] Add real-time streaming transcription (Groq streaming API)
- [ ] Implement voice activity detection (VAD) for auto-stop recording
- [ ] Add background noise filtering
- [ ] Support multiple languages via Groq Whisper
- [ ] Add recording quality visualization/waveform
- [ ] Cache TTS responses for common phrases

## Support

For issues or questions:
1. Check backend logs: `tail -f backend/app.log`
2. Enable frontend console: Open DevTools (F12) in browser
3. Test Groq API directly: `curl -X POST https://api.groq.com/...`
4. Verify Android permissions in Settings app
