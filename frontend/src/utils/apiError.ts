/**
 * apiError.ts — Extracts the backend's actual error message from a failed
 * API call, falling back to a generic message when the response has none.
 *
 * Every controller error response is `{ success: false, error: string }`
 * (see backend/src/middleware/errorHandler.ts and the per-controller 4xx
 * responses), so `err.response.data.error` is always the specific,
 * human-readable reason — e.g. a rack U-position collision or an asset-count
 * delete guard — whereas `err.message` on an Axios error is just the generic
 * "Request failed with status code 409", which throws away that reason.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const response = (err as { response?: { data?: { error?: unknown } } }).response;
    const serverMsg = response?.data?.error;
    if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
  }
  return fallback;
}
