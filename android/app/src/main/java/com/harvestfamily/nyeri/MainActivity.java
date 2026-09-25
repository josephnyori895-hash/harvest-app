package com.harvestfamily.nyeri;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Edge-to-edge: we draw behind the status bar and gesture bar, and
        // expose the real insets to the web layer as CSS variables.
        // (Android WebView does not populate env(safe-area-inset-*), and
        // Capacitor's own CSS-var injection is zeroed on pre-Android-15
        // devices — so MainActivity is the single source of truth.)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        View contentView = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean keyboardVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            float density = getResources().getDisplayMetrics().density;
            int topDp = Math.round(bars.top / density);
            int bottomDp = Math.round(bars.bottom / density);
            int leftDp = Math.round(bars.left / density);
            int rightDp = Math.round(bars.right / density);

            WebView webView = (WebView) findViewById(getBridge().getWebView().getId());
            if (webView != null) {
                String js = String.format(
                        "try{" +
                        "document.documentElement.style.setProperty('--safe-area-inset-top','%dpx');" +
                        "document.documentElement.style.setProperty('--safe-area-inset-bottom','%dpx');" +
                        "document.documentElement.style.setProperty('--safe-area-inset-left','%dpx');" +
                        "document.documentElement.style.setProperty('--safe-area-inset-right','%dpx');" +
                        "document.documentElement.style.setProperty('--keyboard-inset-bottom','%dpx');" +
                        "document.documentElement.dispatchEvent(new CustomEvent('safe-area-change'));" +
                        "}catch(e){}",
                        topDp, bottomDp, leftDp, rightDp, keyboardVisible ? Math.round(ime.bottom / density) : 0
                );
                webView.evaluateJavascript(js, null);
            }
            // Keep the insets flowing to WebView so its visual viewport can resize for the IME.
            return windowInsets;
        });
    }
}
