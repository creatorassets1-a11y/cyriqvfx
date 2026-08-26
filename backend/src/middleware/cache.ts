import type { Request, Response, NextFunction } from 'express';

/**
 * Cache headers for safe public data (PRD §58). Anything user-specific is
 * explicitly marked private so it can never land in a shared cache.
 */
export function publicCache(seconds: number, staleWhileRevalidate = seconds * 4) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // A signed-in viewer may see saved-state or unlisted items; never share those.
    if (req.user) {
      res.setHeader('Cache-Control', 'private, no-store');
      return next();
    }
    res.setHeader(
      'Cache-Control',
      `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${staleWhileRevalidate}`,
    );
    res.setHeader('Vary', 'Cookie, Accept-Encoding');
    next();
  };
}

export function privateNoStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}
