package com.canopylabs.maya.plugins;

import android.media.MediaRecorder;
import android.os.Build;
import java.io.File;
import java.io.FileInputStream;
import java.util.Base64;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONObject;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;

public class AudioRecorderPlugin extends CordovaPlugin {
    private MediaRecorder mediaRecorder;
    private String recordingFilePath;
    private CallbackContext recordingCallback;

    private static final String ACTION_START = "startRecording";
    private static final String ACTION_STOP = "stopRecording";
    
    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
        if (ACTION_START.equals(action)) {
            startRecording(callbackContext);
            return true;
        } else if (ACTION_STOP.equals(action)) {
            stopRecording(callbackContext);
            return true;
        }
        return false;
    }

    private void startRecording(CallbackContext callbackContext) {
        // Check microphone permission
        if (ContextCompat.checkSelfPermission(
                this.cordova.getActivity(),
                Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            callbackContext.error("PERMISSION_DENIED");
            return;
        }

        try {
            // Create temp file for recording
            File cacheDir = this.cordova.getActivity().getCacheDir();
            File audioFile = new File(cacheDir, "maya_voice_" + System.currentTimeMillis() + ".wav");
            recordingFilePath = audioFile.getAbsolutePath();

            // Initialize MediaRecorder
            mediaRecorder = new MediaRecorder();
            mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            mediaRecorder.setOutputFile(recordingFilePath);
            mediaRecorder.prepare();
            mediaRecorder.start();

            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, "recording"));
        } catch (Exception e) {
            callbackContext.error("ERROR: " + e.getMessage());
            if (mediaRecorder != null) {
                mediaRecorder.release();
                mediaRecorder = null;
            }
        }
    }

    private void stopRecording(CallbackContext callbackContext) {
        try {
            if (mediaRecorder != null) {
                mediaRecorder.stop();
                mediaRecorder.release();
                mediaRecorder = null;

                // Read file and convert to base64
                if (recordingFilePath != null) {
                    File audioFile = new File(recordingFilePath);
                    byte[] audioBytes = readFile(audioFile);
                    String base64Audio = Base64.getEncoder().encodeToString(audioBytes);

                    // Clean up
                    audioFile.delete();

                    JSONObject result = new JSONObject();
                    result.put("value", base64Audio);
                    callbackContext.success(result);
                }
            } else {
                callbackContext.error("No recording in progress");
            }
        } catch (Exception e) {
            callbackContext.error("ERROR: " + e.getMessage());
        }
    }

    private byte[] readFile(File file) throws Exception {
        FileInputStream fis = new FileInputStream(file);
        byte[] data = new byte[(int) file.length()];
        fis.read(data);
        fis.close();
        return data;
    }
}
