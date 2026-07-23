import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from '../errors/ApiError';
import { IUserPayload } from '../../@types';

export const auth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      throw new ApiError(401, 'Authentication required');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as IUserPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        status: 'error',
        message: error.message
      });
    }
    return res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token'
    });
  }
};
