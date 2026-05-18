import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler so uncaught promise rejections are forwarded
 * to Express's next(error) instead of causing an unhandled rejection.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
