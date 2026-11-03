export const DEFAULT_IMPORTANT_REQUEST_TIMEOUT_MS = 20_000;

export function withAsyncTimeout(
  request,
  timeoutMs = DEFAULT_IMPORTANT_REQUEST_TIMEOUT_MS,
  message = "요청 시간이 초과되었습니다. 다시 시도해 주세요."
) {
  let timerId = null;
  const safeTimeoutMs = Math.max(1, Number(timeoutMs) || DEFAULT_IMPORTANT_REQUEST_TIMEOUT_MS);
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      const error = new Error(message);
      error.name = "AsyncTimeoutError";
      error.code = "client/deadline-exceeded";
      reject(error);
    }, safeTimeoutMs);
  });

  return Promise.race([Promise.resolve(request), timeout]).finally(() => {
    if (timerId !== null) clearTimeout(timerId);
  });
}
