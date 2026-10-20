package com.enclave.platform.web;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Builds and writes RFC 9457 problem details for {@link EnclaveException}s (specs §22). Used by
 * the MVC exception handler and by servlet filters that fail before reaching a controller.
 */
@Component
public class ProblemWriter {

    /** Base URI of problem {@code type} values. */
    public static final String TYPE_BASE = "https://enclave.dev/errors/";

    private final ObjectMapper mapper;

    ProblemWriter(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * @param e domain exception
     * @return problem detail with {@code code} and exception properties as members
     */
    public ProblemDetail toProblem(EnclaveException e) {
        return toProblem(e.code(), e.getMessage(), e.properties());
    }

    /**
     * @param code error code
     * @param detail sanitized detail
     * @param properties extra members
     * @return problem detail
     */
    public ProblemDetail toProblem(ErrorCode code, String detail, Map<String, Object> properties) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(code.status(), detail);
        problem.setTitle(code.title());
        problem.setType(java.net.URI.create(TYPE_BASE + code.name().toLowerCase(Locale.ROOT).replace('_', '-')));
        problem.setProperty("code", code.name());
        properties.forEach(problem::setProperty);
        return problem;
    }

    /**
     * Writes the problem directly to a servlet response.
     *
     * @param response servlet response (must not be committed)
     * @param e domain exception
     * @throws IOException on write failure
     */
    public void write(HttpServletResponse response, EnclaveException e) throws IOException {
        ProblemDetail problem = toProblem(e);
        response.setStatus(problem.getStatus());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        mapper.writeValue(response.getOutputStream(), problem);
    }
}
