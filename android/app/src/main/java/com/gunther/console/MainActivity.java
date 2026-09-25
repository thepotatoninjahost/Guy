package com.gunther.console;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The project host must be registered before the bridge is created, so
        // the WebView sees window.Capacitor.Plugins.GuntherProject from the
        // first paint — the console probes for it at boot.
        registerPlugin(GuntherProjectPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
