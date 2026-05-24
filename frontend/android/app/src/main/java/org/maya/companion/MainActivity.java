public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {

        super.onCreate(savedInstanceState);

        AudioManager audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);

        if (audioManager != null) {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }

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

            this.bridge.getWebView().setWebChromeClient(
                    new com.getcapacitor.BridgeWebChromeClient(this.bridge) {

                        @Override
                        public void onPermissionRequest(
                                final android.webkit.PermissionRequest request) {

                            request.grant(request.getResources());
                        }
                    });
        }
    }

    @Override
    protected void onResume() {

        super.onResume();

        AudioManager audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);

        if (audioManager != null) {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }
    }
}