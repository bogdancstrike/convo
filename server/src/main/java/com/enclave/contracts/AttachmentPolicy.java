package com.enclave.contracts;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/** Public upload policy. The single limit describes plaintext; the server allows encryption overhead. */
@Validated
@ConfigurationProperties("enclave.attachment-policy")
public record AttachmentPolicy(@DefaultValue("100") @Min(1) @Max(1024) long maxFileMegabytes) {
    public long maxFileBytes() { return Math.multiplyExact(maxFileMegabytes, 1024L * 1024); }
    public long maxCiphertextBytes() {
        long size = maxFileBytes();
        long encoded = 24 + size + Math.max(1, (size + 65535) / 65536) * 16;
        return Math.max(541, (long) Math.ceil(Math.pow(1.05, Math.ceil(Math.log(encoded) / Math.log(1.05)))));
    }
}
