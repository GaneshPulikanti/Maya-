import { registerPlugin } from '@capacitor/core';

declare module '@capacitor/core' {
  interface PluginRegistry {
    AudioRecorder: AudioRecorderPlugin;
  }
}

export interface AudioRecorderPlugin {
  /**
   * Start recording audio from microphone
   * @returns Promise that resolves when recording starts
   */
  startRecording(): Promise<{ value: string }>;

  /**
   * Stop recording audio and return base64-encoded WAV data
   * @returns Promise with base64 audio data in 'value' property
   */
  stopRecording(): Promise<{ value: string }>;
}

const AudioRecorder = registerPlugin<AudioRecorderPlugin>('AudioRecorder', {
  web: () => import('./web').then(m => new m.AudioRecorderWeb()),
});

export * from './definitions';
export { AudioRecorder };
