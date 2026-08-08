plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.apexedits.core.nativeengine"
    compileSdk = libs.versions.compileSdk.get().toInt()

    // Pinned to the NDK actually installed (see ADR 0006's toolchain
    // verification) rather than AGP's bundled default, so a fresh checkout
    // fails at configuration time with a clear version mismatch instead of
    // silently downloading a different NDK than the one the C++ was built
    // against.
    ndkVersion = "30.0.15729638"

    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        externalNativeBuild {
            cmake {
                cppFlags += listOf("-std=c++20", "-fno-exceptions", "-fno-rtti")
                // arm64 first as the PRD specifies; armeabi-v7a keeps the older
                // end of the supported range installable.
                abiFilters += listOf("arm64-v8a", "armeabi-v7a")
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.1"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11) } }

    sourceSets["main"].kotlin.srcDir("src/main/kotlin")
    sourceSets["test"].kotlin.srcDir("src/test/kotlin")
}

dependencies {
    implementation(project(":core:model"))
    testImplementation(libs.junit)
}

/**
 * Builds and runs the C++ host tests.
 *
 * The engine's portable core compiles for the host as well as for Android
 * precisely so its numerics can be tested without a device — the development
 * environment has no GPU and no emulator. Wired into `check`, so `./gradlew test`
 * covers the C++ too.
 */
val hostTestBinary = layout.buildDirectory.file("host-test/apex_matte_test")

val compileHostTests by tasks.registering(Exec::class) {
    group = "verification"
    description = "Compiles the C++ core and its tests for the host."
    val out = hostTestBinary.get().asFile
    outputs.file(out)
    inputs.dir("src/main/cpp")
    inputs.dir("src/hostTest/cpp")
    doFirst { out.parentFile.mkdirs() }
    commandLine(
        "g++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror",
        "-o", out.absolutePath,
        file("src/main/cpp/apex/matte/chroma_key.cpp").absolutePath,
        file("src/hostTest/cpp/chroma_key_test.cpp").absolutePath,
    )
}

val hostTest by tasks.registering(Exec::class) {
    group = "verification"
    description = "Runs the C++ host tests."
    dependsOn(compileHostTests)
    commandLine(hostTestBinary.get().asFile.absolutePath)
}

tasks.named("check") { dependsOn(hostTest) }
