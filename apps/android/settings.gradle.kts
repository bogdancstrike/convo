pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories {
    google(); mavenCentral()
    // Only LiveKit's audioswitch fork is published on JitPack; nothing else may resolve from it.
    maven { url = uri("https://jitpack.io"); content { includeGroup("com.github.davidliu") } }
} }
rootProject.name = "Convo"
include(":app")
