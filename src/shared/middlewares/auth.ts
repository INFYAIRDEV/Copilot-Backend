import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UnauthorizedError } from "../errors/error.js";

// export const auth = async (req: Request, res: Response, next: NextFunction) => {
//   try {
//     const token = req.headers.authorization?.replace("Bearer ", "");

//     if (!token) {
//       throw new UnauthorizedError("Authentication required");
//     }

//     const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET || "";
//     const decoded = jwt.verify(token, secret) as any;
//     req.user = decoded;
//     next();
//   } catch (error: any) {
//     if (error instanceof UnauthorizedError) {
//       return res.status(error.statusCode).json({
//         status: "error",
//         message: error.messageKey || error.message,
//       });
//     }
//     return res.status(401).json({
//       status: "error",
//       message: "Invalid or expired token",
//     });
//   }
// };

export { verifyAccessToken as auth } from "../utils/jwt.js";
