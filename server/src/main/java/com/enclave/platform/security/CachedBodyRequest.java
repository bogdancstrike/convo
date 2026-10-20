package com.enclave.platform.security;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Request wrapper that buffers the body once (bounded) so it can be hashed for signature
 * verification and still be read by the controller.
 */
final class CachedBodyRequest extends HttpServletRequestWrapper {

    private final byte[] body;

    private CachedBodyRequest(HttpServletRequest request, byte[] body) {
        super(request);
        this.body = body;
    }

    /**
     * Buffers the request body.
     *
     * @param request original request
     * @param maxBytes maximum body size
     * @return wrapper, or {@code null} if the body exceeds {@code maxBytes}
     * @throws IOException on read failure
     */
    static CachedBodyRequest wrap(HttpServletRequest request, int maxBytes) throws IOException {
        long declared = request.getContentLengthLong();
        if (declared > maxBytes) {
            return null;
        }
        try (InputStream in = request.getInputStream()) {
            byte[] bytes = in.readNBytes(maxBytes + 1);
            return bytes.length > maxBytes ? null : new CachedBodyRequest(request, bytes);
        }
    }

    /** @return buffered body bytes */
    byte[] body() {
        return body;
    }

    @Override
    public ServletInputStream getInputStream() {
        ByteArrayInputStream in = new ByteArrayInputStream(body);
        return new ServletInputStream() {
            @Override
            public boolean isFinished() {
                return in.available() == 0;
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setReadListener(ReadListener listener) {
                throw new UnsupportedOperationException("async reads are not supported");
            }

            @Override
            public int read() {
                return in.read();
            }

            @Override
            public int read(byte[] b, int off, int len) {
                return in.read(b, off, len);
            }
        };
    }

    @Override
    public BufferedReader getReader() {
        return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }
}
