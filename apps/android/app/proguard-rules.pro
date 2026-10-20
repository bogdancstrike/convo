# The only entry into native presentation from the packaged protocol adapter.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
