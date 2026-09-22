plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ke.dzeline.smslistener"
    compileSdk = 34

    defaultConfig {
        applicationId = "ke.dzeline.smslistener"
        // 23, not 21. Two calls this app cannot work without are newer than 21:
        // Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS is API 22 and
        // Context.getColor is API 23, so a minSdk of 21 makes lint fail the
        // release build (NewApi is fatal to lintVitalRelease). API 23 is a
        // 2015 floor and costs no realistic device coverage today.
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    // Java 17, not 8. AGP 8.x itself runs on JDK 17 and publishes only
    // Java-11+ variants, so a Java 8 consumer cannot resolve it — that is the
    // "No matching variant of com.android.tools.build:gradle:8.2.2 ...
    // compatible with Java 8" failure. 17 also matches the JDK the APK
    // workflow sets up.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
}
