package com.enclave.identity.internal.account;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DirectoryTextTest {

    @Test
    void foldsDiacriticsCaseAndWhitespace() {
        assertThat(DirectoryText.fold("  Ștefan   Țăranu ")).isEqualTo("stefan taranu");
        assertThat(DirectoryText.fold("  ")).isNull();
    }

    @Test
    void normalizesPhoneDigitsAndDetectsPhoneQueries() {
        assertThat(DirectoryText.phoneDigits("+40 (721) 000-001")).isEqualTo("40721000001");
        assertThat(DirectoryText.looksLikePhone("0721 000 001")).isTrue();
        assertThat(DirectoryText.looksLikePhone("+40721")).isTrue();
        assertThat(DirectoryText.looksLikePhone("ana")).isFalse();
        assertThat(DirectoryText.looksLikePhone("ana 0721")).isFalse();
    }

    @Test
    void cleansControlCharactersAndBoundsLength() {
        assertThat(DirectoryText.clean("Ana\u0000 Pop‮", 128)).isEqualTo("Ana  Pop");
        assertThat(DirectoryText.clean("x".repeat(200), 128)).hasSize(128);
        assertThat(DirectoryText.clean("   ", 10)).isNull();
    }
}
