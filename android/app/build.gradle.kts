plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.bughunter.mobile"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.bughunter.mobile"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "targetApp"
    productFlavors {
        create("shop") {
            dimension = "targetApp"
            applicationId = "com.bughunter.mobile.shop"
            resValue("string", "app_name", "Demo Shop Mobile")
            buildConfigField("String", "APP_FLAVOR", "\"shop\"")
            buildConfigField("String", "DEFAULT_BACKEND", "\"http://10.0.2.2:5290\"")
        }
        create("hotel") {
            dimension = "targetApp"
            applicationId = "com.bughunter.mobile.hotel"
            resValue("string", "app_name", "Demo Hotel Mobile")
            buildConfigField("String", "APP_FLAVOR", "\"hotel\"")
            buildConfigField("String", "DEFAULT_BACKEND", "\"http://10.0.2.2:5291\"")
        }
        create("voice") {
            dimension = "targetApp"
            applicationId = "com.bughunter.mobile.voice"
            resValue("string", "app_name", "Voice Appointment")
            buildConfigField("String", "APP_FLAVOR", "\"voice\"")
            buildConfigField("String", "DEFAULT_BACKEND", "\"http://10.0.2.2:11434\"")
        }
    }

    buildTypes {
        release {
            optimization {
                enable = false
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.squareup.retrofit)
    implementation(libs.squareup.retrofit.converter.gson)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.nanohttpd)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}
