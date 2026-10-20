# Enclave backend: reproducible Gradle build, minimal non-root JRE runtime.
FROM gradle:8.14-jdk21 AS build
WORKDIR /src
COPY settings.gradle.kts build.gradle.kts ./
RUN gradle dependencies --no-daemon -q > /dev/null
COPY src src
RUN gradle bootJar --no-daemon -q -x test

FROM eclipse-temurin:21-jre
RUN groupadd --system --gid 10001 enclave && useradd --system --uid 10001 --gid enclave enclave
WORKDIR /app
COPY --from=build /src/build/libs/enclave-server.jar /app/enclave-server.jar
USER 10001
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=10 \
  CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080 && printf "GET /actuator/health/readiness HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" >&3 && grep -q "UP" <&3'
ENTRYPOINT ["java", "-jar", "/app/enclave-server.jar"]
