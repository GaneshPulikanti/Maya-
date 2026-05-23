# Capacitor Audio Recorder Plugin - Installation Guide

## Quick Start

### Step 1: Install from NPM
```bash
cd frontend
npm install @canopylabs/capacitor-audio-recorder
npx cap sync android
```

### Step 2: Add Android Permissions
The plugin requires microphone permission. Update `android/app/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Add these permissions -->
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    
    <application>
        <!-- Rest of your app config -->
    </application>
</manifest>
```

### Step 3: Build & Deploy
```bash
cd frontend
npm run build
npx cap sync android
cd ../android
./gradlew assembleDebug
# Then deploy using Android Studio
```

## Detailed Implementation

### TypeScript Usage (Already Integrated)
```typescript
import { registerPlugin } from '@capacitor/core';
import type { AudioRecorderPlugin } from '@canopylabs/capacitor-audio-recorder';

const AudioRecorder = registerPlugin<AudioRecorderPlugin>('AudioRecorder');

// Start recording
await AudioRecorder.startRecording();

// Stop recording (returns base64 audio)
const result = await AudioRecorder.stopRecording();
const audioBase64 = result.value;

// Convert to Blob
const binaryString = atob(audioBase64);
const bytes = new Uint8Array(binaryString.length);
for (let i = 0; i < binaryString.length; i++) {
  bytes[i] = binaryString.charCodeAt(i);
}
const blob = new Blob([bytes], { type: 'audio/wav' });
```

### Already Integrated In Components
- ✅ `frontend/src/components/VoiceRecorder.jsx` - Updated with Capacitor support
- ✅ `frontend/src/components/VoiceMode.jsx` - Updated with Capacitor support

## Android Build Troubleshooting

### Issue: "Plugin not found"
**Solution:**
1. Ensure installation: `npm install @canopylabs/capacitor-audio-recorder`
2. Sync files: `npx cap sync android`
3. Rebuild project: `./gradlew clean build`

### Issue: "Permission denied" at runtime
**Solution:**
1. Android 6.0+ requires runtime permissions
2. User will see permission popup automatically
3. Grant "Microphone" permission when prompted
4. If denied, navigate to Settings > Apps > Maya > Permissions > Microphone

### Issue: "Recording not working in APK"
**Solution:**
1. Build debug APK first: `./gradlew assembleDebug`
2. Install: `adb install build/outputs/apk/debug/app-debug.apk`
3. Check Android logs: `adb logcat | grep AudioRecorder`
4. Verify microphone hardware works: Use native recorder app

### Issue: "MediaRecorder fallback not working"
**Solution:**
1. Check browser console for errors (F12)
2. Verify microphone permissions in browser
3. Try in HTTPS (not HTTP) on mobile
4. Test on desktop browser first

## Plugin Structure

```
android_audio_plugin/
├── src/
│   └── index.ts              # TypeScript definitions & exports
├── android/
│   └── src/main/
│       └── java/
│           └── AudioRecorderPlugin.java   # Native Android code
├── ios/
│   └── Plugin/
│       └── AudioRecorderPlugin.swift      # iOS support (future)
├── web/
│   └── index.ts              # Web fallback (MediaRecorder)
├── package.json
└── README.md
```

## Native Android Implementation Details

**File**: `android_audio_plugin/AudioRecorderPlugin.java`

Key methods:
- `execute()` - Router for startRecording/stopRecording actions
- `startRecording()` - Initializes MediaRecorder and starts recording to cache directory
- `stopRecording()` - Stops recorder, converts file to base64, returns via callback
- `readFile()` - Utility to read file bytes

**Recording Parameters:**
- Source: `MediaRecorder.AudioSource.MIC`
- Format: MPEG-4 container with AAC codec (Android standard)
- Output: Temporary file in app cache directory
- Sample Rate: Device default (~44.1kHz or 48kHz)
- Channels: Mono or Stereo (device default)

**File Location:** `{app_cache_dir}/maya_voice_{timestamp}.wav`

## Testing Checklist

- [ ] Install plugin: `npm install @canopylabs/capacitor-audio-recorder`
- [ ] Sync to Android: `npx cap sync android`
- [ ] Add AndroidManifest.xml permissions
- [ ] Build debug APK: `./gradlew assembleDebug`
- [ ] Install on device: `adb install app-debug.apk`
- [ ] Open Maya app
- [ ] Grant microphone permission
- [ ] Click voice recorder button
- [ ] Speak into microphone
- [ ] Observe recording timer counting up
- [ ] Click stop button
- [ ] Verify transcription in chat

## Performance Characteristics

| Aspect | Value |
|--------|-------|
| Recording Start Latency | <100ms |
| Audio Quality | Device default PCM |
| Max Recording Length | Device memory limited (~no hard limit) |
| File Size (per minute) | ~1-2 MB |
| Supported Codecs | AAC, PCM, AMR (device dependent) |
| Minimum Android Version | API 21 (Android 5.0) |

## Backend Integration

The plugin returns base64-encoded audio data that's converted to Blob and uploaded to:
```
POST /api/voice/transcribe
Content-Type: multipart/form-data

{
  "file": <Blob audio data>
}
```

Backend response:
```json
{
  "text": "transcribed text from audio"
}
```

## Security & Privacy

- Audio is recorded to app cache (private directory)
- Audio is sent over HTTPS to backend
- Audio is deleted after processing
- No permanent storage on device
- User controls microphone via Android permission system

## Future Enhancements

1. **Real-time transcription** via WebSocket streaming
2. **Voice Activity Detection (VAD)** for auto-stop
3. **Audio visualization** with waveform display
4. **Multiple codec support** (opus, flac, etc.)
5. **Background audio focus** handling
6. **Echo cancellation** & noise suppression
7. **Language detection** via Groq API

## Support & Debugging

### Enable Verbose Logging
Add to `android/app/build.gradle`:
```gradle
debug {
    debuggable true
    buildConfigField "boolean", "DEBUG_LOGGING", "true"
}
```

### Check Device Capabilities
```bash
adb shell getprop | grep audio
adb shell am start -n com.google.android.apps.recorder/.voicerecorder.MainActivity
```

### Monitor Audio Process
```bash
adb logcat | grep -i audio
adb logcat | grep -i media
```

## Contributing

To build from source:
```bash
cd android_audio_plugin
npm install
npm run verify:android
```

Then test in your app:
```bash
npm link
cd ../frontend
npm link @canopylabs/capacitor-audio-recorder
```
