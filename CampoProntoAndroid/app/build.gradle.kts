plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose"); id("org.jetbrains.kotlin.plugin.serialization") }
android {
    namespace = "it.campopronto.ads"
    compileSdk = 36
    defaultConfig {
        applicationId = "it.campopronto.ads"
        minSdk = 24
        targetSdk = 36
        versionCode = 59
        versionName = "2.1"
        manifestPlaceholders["admobAppId"] = providers.gradleProperty("admobAppId").getOrElse("ca-app-pub-3940256099942544~3347511713")
        buildConfigField("String", "BANNER_UNIT", "\"${providers.gradleProperty("bannerUnit").getOrElse("")}\"")
        buildConfigField("String", "INTERSTITIAL_UNIT", "\"${providers.gradleProperty("interstitialUnit").getOrElse("")}\"")
        buildConfigField("String", "REWARDED_UNIT", "\"${providers.gradleProperty("rewardedUnit").getOrElse("")}\"")
    }
    signingConfigs {
        create("upload") {
            val path = System.getenv("CAMPOPRONTO_UPLOAD_KEYSTORE")
            if (path != null) {
                storeFile = file(path)
                storePassword = System.getenv("CAMPOPRONTO_UPLOAD_STORE_PASSWORD")
                keyAlias = "campopronto-upload"
                keyPassword = System.getenv("CAMPOPRONTO_UPLOAD_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release {
            signingConfig = signingConfigs.getByName("upload")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17; isCoreLibraryDesugaringEnabled = true }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.00"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.google.android.gms:play-services-ads:25.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    testImplementation("junit:junit:4.13.2")
}
