// Root build. Plugins are declared here without applying them so every module
// resolves the same version from the catalogue.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}

/**
 * Lets tests run against a real media file when one is supplied:
 *
 *     ./gradlew test -Papex.sampleVideo=/path/to/clip.mp4
 *
 * Without it, tests that need real bytes skip themselves rather than failing, so
 * CI stays green without a video committed to the repository.
 */
subprojects {
    tasks.withType<Test>().configureEach {
        (project.findProperty("apex.sampleVideo") as String?)?.let {
            systemProperty("apex.sampleVideo", it)
        }
    }
}
