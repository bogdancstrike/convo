plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.convo.android"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.convo.android"
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-dev"
        manifestPlaceholders["appAuthRedirectScheme"] = "com.convo.android"
        // Certified targets (docs/mobile.md §9): arm64 phones and x86_64 emulators. Keeps WebRTC native libs small.
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildTypes {
        debug {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        release { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") }
    }
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.biometric:biometric:1.1.0")
    // Calls: official LiveKit SDK (Apache-2.0) with E2EE frame cryptors; see ADR-0006.
    implementation("io.livekit:livekit-android:2.29.0")
    // Device-linking QR codes (Apache-2.0): ZXing core for rendering, embedded scanner for approval.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // MSG-02 wake-ups via a UnifiedPush distributor (e.g. self-hosted ntfy).
    implementation("org.unifiedpush.android:connector:3.0.10") { exclude(group = "com.google.crypto.tink", module = "tink") }
    // Android flavour of Tink (protobuf-javalite), compatible with LiveKit's protobuf.
    implementation("com.google.crypto.tink:tink-android:1.17.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("net.openid:appauth:0.11.1")
    implementation("com.googlecode.libphonenumber:libphonenumber:8.13.55")
}
