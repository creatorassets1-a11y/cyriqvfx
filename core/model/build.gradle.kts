import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

// Deliberately a plain JVM module. The document model must not reach for an
// Android API, so the build makes that impossible rather than asking reviewers
// to notice.
//
// Bytecode targets Java 11 to match the Android modules that consume it; no
// toolchain is declared so the build uses whichever supported JDK is present.
java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_11) }
}

dependencies {
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}

tasks.withType<Test>().configureEach { useJUnit() }
