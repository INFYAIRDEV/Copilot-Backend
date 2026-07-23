import { Request, Response, NextFunction } from 'express';

// Simple in-memory rate limiter (replace with Redis in production)
const requests = new Map<string, { count: number; resetTime: number }>();

export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const currentTime = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 100;

  const requestData = requests.get(ip);
  
  if (!requestData || currentTime > requestData.resetTime) {
    requests.set(ip, {
      count: 1,
      resetTime: currentTime + windowMs
    });
    return next();
  }

  if (requestData.count >= maxRequests) {
    return res.status(429).json({
      status: 'error',
      message: 'Too many requests, please try again later.'
    });
  }

  requestData.count++;
  next();
};
