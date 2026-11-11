package app.homenet.control;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 把系统字体缩放倍率交给页面 */
@CapacitorPlugin(name = "FontScale")
public class FontScalePlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("scale", getContext().getResources().getConfiguration().fontScale);
        call.resolve(ret);
    }
}
