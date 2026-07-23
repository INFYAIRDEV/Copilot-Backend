import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError';

export const errorHandler = (
  error: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
      ...(error.errors && { errors: error.errors })
    });
  }

  console.error('Unhandled error:', error);
  
  return res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
};
