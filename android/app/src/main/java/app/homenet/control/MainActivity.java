package app.homenet.control;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FontScalePlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        // 系统字体放大由页面按 0.85–1.3 倍整体 zoom（native.ts），WebView 只放大文字会把磁贴撑破
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
