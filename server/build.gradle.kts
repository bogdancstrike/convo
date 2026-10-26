/*
 * Enclave backend — one Spring Modulith runtime (see docs/arf.md §3.1, ADR-026).
 *
 * Feature modules live as top-level packages below `com.enclave` and are verified by
 * `ModularityTests`. Dependency versions are pinned through the Spring Boot and Spring
 * Modulith BOMs; bump them deliberately and record the change in the release BOM.
 */
plugins {
    java
    jacoco
    id("org.springframework.boot") version "4.1.1"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "com.enclave"
version = "0.1.0-SNAPSHOT"
description = "Enclave on-prem E2EE messaging backend"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

repositories { mavenCentral() }

extra["springModulithVersion"] = "2.1.1"

dependencyManagement {
    imports {
        mavenBom("org.springframework.modulith:spring-modulith-bom:${property("springModulithVersion")}")
    }
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-websocket")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.modulith:spring-modulith-starter-core")
    implementation("org.springframework.modulith:spring-modulith-starter-jdbc")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("software.amazon.awssdk:s3:2.57.0")
    implementation("software.amazon.awssdk:url-connection-client:2.57.0")
    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.modulith:spring-modulith-starter-test")
    testImplementation("com.tngtech.archunit:archunit-junit5:1.5.1")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<JavaCompile> {
    options.compilerArgs.addAll(listOf("-parameters", "-Xlint:all,-processing,-serial"))
}

tasks.test {
    useJUnitPlatform()
    finalizedBy(tasks.jacocoTestReport)
}

// --- coverage (docs/testing.md) ------------------------------------------------------------------
jacoco { toolVersion = "0.8.13" }

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports { xml.required = true; html.required = true }
}

/** The JaCoCo agent jar, mounted into the dev server container for coverage of API/e2e runs. */
val jacocoAgentJar by tasks.registering(Copy::class) {
    from(zipTree(configurations.jacocoAgent.get().singleFile)) { include("jacocoagent.jar") }
    into(layout.buildDirectory.dir("jacoco-agent"))
}

/** The boot jar at a fixed path for docker-compose.coverage.yaml (same classes as the report). */
val coverageServer by tasks.registering(Copy::class) {
    dependsOn(tasks.bootJar, jacocoAgentJar)
    from(tasks.bootJar.flatMap { it.archiveFile })
    into(layout.buildDirectory.dir("coverage"))
    rename { "enclave-server.jar" }
}

/**
 * Combined backend coverage: JUnit plus the running server exercised by the API, e2e and load
 * suites (the .exec files in build/jacoco-it, written by the agent; see docker-compose.coverage.yaml).
 */
val jacocoCombinedReport by tasks.registering(JacocoReport::class) {
    executionData(fileTree(layout.buildDirectory) { include("jacoco/test.exec", "jacoco-it/*.exec") })
    sourceSets(sourceSets.main.get())
    reports {
        xml.required = true
        html.required = true
        html.outputLocation = layout.buildDirectory.dir("reports/jacoco/combined/html")
        xml.outputLocation = layout.buildDirectory.file("reports/jacoco/combined/jacoco.xml")
    }
}

tasks.bootJar {
    archiveFileName = "enclave-server.jar"
}

tasks.jar {
    enabled = false
}
