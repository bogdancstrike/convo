package com.enclave;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Constructor;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.stereotype.Component;

/**
 * Constructor injection sanity without starting the context (which needs PostgreSQL/Valkey): each
 * component must have one constructor, or exactly one marked {@code @Autowired}. Otherwise Spring
 * fails at startup ("No default constructor found").
 */
class WiringTests {
    @Test void everyComponentHasAnUnambiguousConstructor() throws ClassNotFoundException {
        var scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(Component.class));
        List<String> ambiguous = new ArrayList<>();
        for (var candidate : scanner.findCandidateComponents("com.enclave")) {
            Class<?> type = Class.forName(candidate.getBeanClassName());
            Constructor<?>[] constructors = type.getDeclaredConstructors();
            long autowired = Arrays.stream(constructors).filter(c -> c.isAnnotationPresent(Autowired.class)).count();
            if (constructors.length > 1 && autowired != 1) ambiguous.add(type.getName());
        }
        assertThat(ambiguous).isEmpty();
    }
}
