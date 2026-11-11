# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# 扫码插件（OutSystems ionbarcode）的参数类用了 Gson 注解，但 Gson 只在它编译时用，运行时不需要
-dontwarn com.google.gson.annotations.SerializedName
# 扫码参数经 Intent 序列化在插件和扫码 Activity 之间传递，保留字段名和结构
-keep class com.outsystems.plugins.barcode.model.** { *; }
