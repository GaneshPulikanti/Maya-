# Build & Deploy Android APK Guide

## Prerequisites

### System Requirements
- Android Studio 4.0+ or Android SDK Command Line Tools
- JDK 11+
- Node.js 16+
- npm 8+

### Android SDK Components
- Android SDK Platform API 30+ (target API ~33-34)
- Build Tools 33.0.0+
- Android Emulator or physical device (for testing)

## Step-by-Step APK Build Process

### Phase 1: Frontend Build

#### 1.1 Install Dependencies
```bash
cd /Users/ganesh/chatbot/frontend
npm install
```

#### 1.2 Build for Production
```bash
npm run build
# Output: dist/ folder with optimized HTML/CSS/JS
```

### Phase 2: Capacitor Setup

#### 2.1 Install Capacitor CLI
```bash
npm install -g @capacitor/cli
```

#### 2.2 Initialize Capacitor (if not done)
```bash
npx cap init "Maya" "com.canopylabs.maya" --web-dir dist
```

#### 2.3 Add Android Platform
```bash
npx cap add android
```

#### 2.4 Install Audio Recorder Plugin
```bash
npm install @canopylabs/capacitor-audio-recorder
npx cap sync android
```

#### 2.5 Sync All Changes
```bash
npx cap sync android
```

### Phase 3: Android Configuration

#### 3.1 Open Android Project
```bash
cd /Users/ganesh/chatbot/android
# or open with Android Studio:
open -a "Android Studio" .
```

#### 3.2 Configure Build Properties

**File:** `android/app/build.gradle`
```gradle
android {
    compileSdk 34
    
    defaultConfig {
        applicationId "com.canopylabs.maya"
        minSdk 21           // Minimum Android 5.0
        targetSdk 34        // Target API 34+
        versionCode 1
        versionName "1.0.0"
    }
    
    buildTypes {
        debug {
            debuggable true
        }
        release {
            minifyEnabled false  // Keep true for production
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

#### 3.3 Update AndroidManifest.xml

**File:** `android/app/src/main/AndroidManifest.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.canopylabs.maya">

    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

    <application
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>

</manifest>
```

### Phase 4: Build APK

#### 4.1 Clean Build (Recommended)
```bash
cd /Users/ganesh/chatbot/android
./gradlew clean
```

#### 4.2 Build Debug APK
```bash
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

**OR for Release APK:**
```bash
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
```

#### 4.3 Verify Build
```bash
ls -lh app/build/outputs/apk/debug/app-debug.apk
# Should be 5-15 MB
```

### Phase 5: Deploy to Device/Emulator

#### 5.1 List Connected Devices
```bash
adb devices
# Output:
# List of attached devices
# emulator-5554           device
# 8ABC...                 device
```

#### 5.2 Install APK
```bash
# To specific device (example):
adb -s 8ABC install /Users/ganesh/chatbot/android/app/build/outputs/apk/debug/app-debug.apk

# Or auto-detect single device:
adb install /Users/ganesh/chatbot/android/app/build/outputs/apk/debug/app-debug.apk
```

#### 5.3 Run on Device
```bash
adb shell am start -n com.canopylabs.maya/.MainActivity
```

#### 5.4 View Logs
```bash
adb logcat | grep -E "AudioRecorder|Capacitor|Maya"
```

### Phase 6: Testing

#### 6.1 Grant Permissions
When app launches, allow:
- Microphone access (popup will appear)
- Storage access (if needed)

#### 6.2 Test Voice Recording
1. Open app → navigate to chat
2. Tap microphone icon
3. Speak clearly
4. Tap mic again to stop
5. Observe transcription in chat input
6. Send message to verify chat flow

#### 6.3 Test Full Voice Loop
1. Tap voice assistant button
2. Listen to instructions
3. Speak response
4. App should transcribe → send → receive reply → speak back

## Troubleshooting Build Issues

### Issue: "Build failed: SDK not found"
```bash
# Install missing Android SDK
sdkmanager "platforms;android-34"
sdkmanager "build-tools;34.0.0"
```

### Issue: "Gradle sync failed"
```bash
# Clean gradle cache
cd android
./gradlew clean
./gradlew --refresh-dependencies
```

### Issue: "Plugin not found at build time"
```bash
# Ensure plugin installed and synced
npm install @canopylabs/capacitor-audio-recorder
npx cap sync android

# Rebuild
cd android
./gradlew clean build
```

### Issue: "APK installation fails"
```bash
# Check package name doesn't exist
adb uninstall com.canopylabs.maya

# Then retry install
adb install app-debug.apk
```

### Issue: "App crashes on startup"
```bash
# Check logs for specific error
adb logcat | head -100

# Common causes:
# 1. Missing plugin registration in MainActivity
# 2. Incompatible Capacitor version
# 3. Missing AndroidManifest.xml permissions
```

## Release Build (For Distribution)

### Generate Signing Key
```bash
keytool -genkey -v -keystore ~/maya-release-key.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias maya-key
```

### Configure Signing in build.gradle
```gradle
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH") ?: "/path/to/maya-release-key.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS") ?: "maya-key"
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
    
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
        }
    }
}
```

### Build Signed Release APK
```bash
export KEYSTORE_PASSWORD="your_keystore_password"
export KEY_PASSWORD="your_key_password"

cd android
./gradlew assembleRelease
# Output: app/build/outputs/apk/release/app-release.apk
```

## Continuous Integration (CI/CD)

### GitHub Actions Example
```yaml
name: Build Android APK

on:
  push:
    branches: [ main, develop ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Setup Java
        uses: actions/setup-java@v2
        with:
          java-version: '11'
          distribution: 'temurin'
      
      - name: Frontend Build
        run: |
          cd frontend
          npm install
          npm run build
      
      - name: Capacitor Sync
        run: |
          npx cap sync android
      
      - name: Build APK
        run: |
          cd android
          ./gradlew assembleDebug
      
      - name: Upload APK
        uses: actions/upload-artifact@v2
        with:
          name: app-debug.apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
```

## Environment Configuration

### Backend URL Configuration
Ensure frontend connects to correct backend:

**File:** `frontend/src/context/AuthContext.jsx`
```javascript
const baseURL = process.env.REACT_APP_API_URL || 'http://10.0.2.2:8000'
// 10.0.2.2 = localhost from Android Emulator
// For physical device: use actual backend IP
```

### Build Environment Variables
```bash
# .env.production (in frontend)
REACT_APP_API_URL=http://your-backend-domain.com
```

## Performance Optimization

### Code Minification
```gradle
buildTypes {
    release {
        minifyEnabled true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

### Bundle Size Optimization
```bash
# Analyze bundle
cd frontend
npm run build
npx webpack-bundle-analyzer dist/bundle.js

# Remove unused code
npm prune --production
```

### Android App Bundle (For Google Play)
```bash
cd android
./gradlew bundleRelease
# Output: app/build/outputs/bundle/release/app-release.aab
```

## Verification Checklist

Before distribution:
- [ ] APK builds without errors
- [ ] APK installs on device/emulator
- [ ] Voice recording works
- [ ] Transcription returns correct text
- [ ] Chat integration functions properly
- [ ] All UI elements visible on mobile
- [ ] Permissions requested correctly
- [ ] No sensitive data in logs (adb logcat)
- [ ] App doesn't crash on extended use
- [ ] Microphone permission persists across app restart

## Size Optimization

| Component | Size |
|-----------|------|
| Base APK | ~5 MB |
| Capacitor Plugins | ~2 MB |
| Frontend Bundle | ~3-4 MB |
| **Total** | **~10-12 MB** |

## Testing on Different Android Versions

```bash
# List available emulator images
emulator -list-avds

# Launch specific emulator
emulator -avd Pixel_5_API_30

# Test on API 21 (Android 5.0 minimum)
emulator -avd Pixel_5_API_21
```

## Support Resources

- Capacitor Docs: https://capacitorjs.com
- Android Developers: https://developer.android.com
- Gradle Reference: https://gradle.org
- Android Studio Docs: https://developer.android.com/studio/intro
