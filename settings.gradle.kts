pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ApexEdits"

// Pure-Kotlin core. No Android dependency: the editorial semantics stay
// testable on a plain JVM, which is what keeps the engine tests fast.
include(":core:model")
include(":core:engine")

// Android core.
include(":core:designsystem")
include(":core:device")
include(":core:data")
include(":core:media")

// Features.
include(":feature:projects")
include(":feature:editor")
include(":feature:export")

include(":app")
