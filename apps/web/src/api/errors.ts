/**
 * RFC 9457 problem returned by the API (specs §22). `code` is the stable machine-readable value;
 * branch on it, never on `title`/`detail`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
    readonly problem: Record<string, unknown> = {},
  ) {
    super(detail || code);
    this.name = 'ApiError';
  }

  /** Builds an ApiError from a non-2xx response. */
  static async from(response: Response): Promise<ApiError> {
    let problem: Record<string, unknown> = {};
    try {
      problem = (await response.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error body */
    }
    const code = typeof problem.code === 'string' ? problem.code : `HTTP_${response.status}`;
    const detail = typeof problem.detail === 'string' ? problem.detail : response.statusText;
    return new ApiError(response.status, code, detail, problem);
  }
}

/** Network-level failure (offline, DNS, TLS, aborted). The outcome of a mutation is unknown. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network unavailable', { cause });
    this.name = 'NetworkError';
  }
}
