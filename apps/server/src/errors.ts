/**
 * 带业务码的应用错误：HTTP 状态只告诉"哪一类"，code 才告诉"到底是什么"。
 * 前端靠 code 决定"要不要重试/找谁"，而不是按 400/500 猜。
 */
export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNPROCESSABLE"
  | "QUOTA_EXHAUSTED"
  | "AUTH_EXPIRED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_BAD_RESPONSE"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** 客户端收到这个错误后是否值得自动重试（默认只对 429/502/503 友好）。 */
  readonly retryable: boolean;
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 = 400,
    code?: AppErrorCode,
  ) {
    super(message);
    this.name = "AppError";
    this.code =
      code ??
      (status === 429
        ? "QUOTA_EXHAUSTED"
        : status === 401
          ? "UNAUTHORIZED"
          : status === 403
            ? "FORBIDDEN"
            : status === 404
              ? "NOT_FOUND"
              : status === 409
                ? "CONFLICT"
                : status === 413
                  ? "PAYLOAD_TOO_LARGE"
                  : status === 422
                    ? "UNPROCESSABLE"
                    : status === 502 || status === 503
                      ? "UPSTREAM_UNAVAILABLE"
                      : status === 500
                        ? "INTERNAL"
                        : "BAD_REQUEST");
    this.retryable = status === 429 || status === 502 || status === 503;
  }
}

/** 统一错误响应体：code/retryable 让客户端不用猜。 */
export function errorBody(
  error: AppError,
  retryAfter?: number,
): {
  error: string;
  code: AppErrorCode;
  retryable: boolean;
  retryAfter?: number;
} {
  return {
    error: error.message,
    code: error.code,
    retryable: error.retryable,
    ...(retryAfter !== undefined ? { retryAfter } : {}),
  };
}
