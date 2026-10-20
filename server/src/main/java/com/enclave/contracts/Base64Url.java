package com.enclave.contracts;

import java.util.Base64;

/**
 * Canonical binary encoding for every JSON API field that carries bytes (keys, ciphertext,
 * signatures, IDs): RFC 4648 base64url <b>without padding</b> (specs §12).
 */
public final class Base64Url {

    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    private Base64Url() {}

    /**
     * @param bytes raw bytes
     * @return unpadded base64url string
     */
    public static String encode(byte[] bytes) {
        return ENCODER.encodeToString(bytes);
    }

    /**
     * Decodes a base64url value, accepting optional padding.
     *
     * @param value encoded value
     * @param field field name used in the error message
     * @return decoded bytes
     * @throws EnclaveException {@link ErrorCode#INVALID_REQUEST} when the value is not base64url
     */
    public static byte[] decode(String value, String field) {
        if (value == null) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, field + " is required");
        }
        try {
            return DECODER.decode(value);
        } catch (IllegalArgumentException e) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, field + " must be base64url");
        }
    }
}
