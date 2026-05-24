package org.maya.companion;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // mic permission
        if (ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {

            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.RECORD_AUDIO },
                    1);
        }
    }

    @Override
    public void onStart() {
        super.onStart();

        if (this.bridge != null && this.bridge.getWebView() != null) {
            // Allow media playback without user gesture
            this.bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

            this.bridge.getWebView().setWebChromeClient(
                    new com.getcapacitor.BridgeWebChromeClient(this.bridge) {
                        @Override
                        public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                            request.grant(request.getResources());
                        }
                    });
        }
    }
}