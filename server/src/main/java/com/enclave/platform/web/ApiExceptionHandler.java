package com.enclave.platform.web;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Maps exceptions thrown by controllers to RFC 9457 problem details with stable error codes.
 * Unexpected exceptions are logged server-side and returned without internal details.
 */
@RestControllerAdvice
class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private final ProblemWriter problems;

    ApiExceptionHandler(ProblemWriter problems) {
        this.problems = problems;
    }

    @ExceptionHandler(EnclaveException.class)
    ProblemDetail domain(EnclaveException e) {
        return problems.toProblem(e);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail validation(MethodArgumentNotValidException e) {
        var fields = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage()).toList();
        return problems.toProblem(ErrorCode.INVALID_REQUEST, "validation failed", Map.of("errors", fields));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
        MissingServletRequestParameterException.class})
    ProblemDetail unreadable(Exception e) {
        return problems.toProblem(ErrorCode.INVALID_REQUEST, "malformed request", Map.of());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ProblemDetail notFound(NoResourceFoundException e) {
        return problems.toProblem(ErrorCode.NOT_FOUND, "no such endpoint", Map.of());
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ProblemDetail method(HttpRequestMethodNotSupportedException e) {
        ProblemDetail p = problems.toProblem(ErrorCode.INVALID_REQUEST, "method not supported", Map.of());
        p.setStatus(405);
        return p;
    }

    @ExceptionHandler(Exception.class)
    ProblemDetail unexpected(Exception e) {
        log.error("Unhandled exception", e);
        ProblemDetail p = ProblemDetail.forStatusAndDetail(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                "internal error");
        p.setProperty("code", "INTERNAL");
        return p;
    }
}
