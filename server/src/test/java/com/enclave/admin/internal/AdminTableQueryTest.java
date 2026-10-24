package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AdminTableQueryTest {
    @Test void searchAndEveryColumnFilterRunBeforeSortingAndPagination() {
        var input = List.<Map<String, Object>>of(Map.of("name", "Ana", "items", 2), Map.of("name", "Dan", "items", 12), Map.of("name", "Dana", "items", 4));
        var query = AdminTableQuery.from(Map.of("q", "dan", "sort", "items", "order", "desc", "page", "1", "size", "1", "f_name", "da"));
        var first = query.apply(input, row -> row);
        assertThat(first.total()).isEqualTo(2); assertThat(first.rows()).containsExactly(input.get(1));
        var next = AdminTableQuery.from(Map.of("q", "dan", "sort", "items", "order", "desc", "page", "2", "size", "1")).apply(input, row -> row);
        assertThat(next.rows()).containsExactly(input.get(2));
    }
    @Test void paginationIsBoundedAndUnknownFieldsDoNotExposeUnfilteredResults() {
        var query = AdminTableQuery.from(Map.of("size", "10000", "page", "-5", "f_secret", "anything"));
        assertThat(query.size()).isEqualTo(100); assertThat(query.page()).isEqualTo(1);
        assertThat(query.apply(List.of(Map.<String, Object>of("name", "Ana")), row -> row).rows()).isEmpty();
    }
}
