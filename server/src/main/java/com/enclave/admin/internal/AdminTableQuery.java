package com.enclave.admin.internal;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

/** Shared server-side table semantics. Field names are always selected from endpoint whitelists. */
record AdminTableQuery(String search, String sort, boolean descending, int page, int size, Map<String, String> filters) {
    record Page<T>(List<T> rows, long total, int page, int size, List<String> warnings) {}
    static AdminTableQuery from(Map<String, String> params) {
        Map<String, String> filters = new LinkedHashMap<>();
        params.forEach((key, value) -> { if (key.startsWith("f_") && value != null && !value.isBlank()) filters.put(key.substring(2), value.substring(0, Math.min(200, value.length()))); });
        return new AdminTableQuery(params.getOrDefault("q", "").strip(), params.getOrDefault("sort", ""), "desc".equals(params.get("order")), number(params.get("page"), 1, 1, 100000), number(params.get("size"), 20, 1, 100), filters);
    }
    private static int number(String value, int fallback, int min, int max) { try { return Math.max(min, Math.min(max, Integer.parseInt(value))); } catch (RuntimeException e) { return fallback; } }
    <T> Page<T> apply(List<T> input, Function<T, Map<String, Object>> fields) {
        String query = search.toLowerCase(Locale.ROOT);
        var rows = new ArrayList<>(input.stream().filter(row -> {
            Map<String, Object> values = fields.apply(row);
            return (query.isBlank() || values.values().stream().anyMatch(value -> text(value).contains(query)))
                    && filters.entrySet().stream().allMatch(filter -> values.containsKey(filter.getKey()) && text(values.get(filter.getKey())).contains(filter.getValue().toLowerCase(Locale.ROOT)));
        }).toList());
        if (!sort.isBlank()) rows.sort((a, b) -> {
            Object x = fields.apply(a).get(sort), y = fields.apply(b).get(sort);
            int c = x == null ? y == null ? 0 : 1 : y == null ? -1 : x instanceof Number n && y instanceof Number m ? Double.compare(n.doubleValue(), m.doubleValue()) : text(x).compareTo(text(y));
            return descending ? -c : c;
        });
        int actual = Math.min(page, Math.max(1, (rows.size() + size - 1) / size));
        int from = Math.min(rows.size(), (actual - 1) * size);
        return new Page<>(List.copyOf(rows.subList(from, Math.min(rows.size(), from + size))), rows.size(), actual, size, List.of());
    }
    static String text(Object value) { return value == null ? "" : value.toString().toLowerCase(Locale.ROOT); }
}
