plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 版本/包名/品牌名全部由 shells/android/ci/build.sh 从 dist/manifest.json 与 shells/versions.json 传进来。
val kitVersion: String = providers.gradleProperty("kitVersion").get()
val appId: String = providers.gradleProperty("appId").getOrElse("com.example.clevervpn")
val appName: String = providers.gradleProperty("appName").getOrElse("Clever VPN")
val appVersionName: String = providers.gradleProperty("appVersionName").getOrElse("0.0.0")
val appVersionCode: Int = providers.gradleProperty("appVersionCode").getOrElse("1").toInt()

val storeFile: String? = providers.gradleProperty("androidReleaseStoreFile").orNull
val storePassword: String? = providers.gradleProperty("androidReleaseStorePassword").orNull
val keyAlias: String? = providers.gradleProperty("androidReleaseKeyAlias").orNull
val keyPassword: String? = providers.gradleProperty("androidReleaseKeyPassword").orNull
val hasSigning = listOf(storeFile, storePassword, keyAlias, keyPassword).all { !it.isNullOrBlank() }

android {
    namespace = "com.clevervpn.app"
    compileSdk = 36

    defaultConfig {
        applicationId = appId
        minSdk = 24
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        resValue("string", "app_name", appName)
    }

    signingConfigs {
        if (hasSigning) {
            create("release") {
                storeFile = file(storeFile!!)
                storePassword = storePassword
                keyAlias = keyAlias
                keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // dist/ 是唯一输入：web/ 与 manifest.json 直接作为 assets（零拷贝）
    sourceSets["main"].assets.srcDirs("src/main/assets", file("../../../dist"))

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    // kit 版本来自 shells/versions.json（ci 传入；项目文件不写死）
    implementation("net.clever-vpn:clever-vpn-android-kit:$kitVersion")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
