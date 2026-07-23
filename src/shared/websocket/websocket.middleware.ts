import { Socket } from "socket.io";
import { NextFunction } from "express";
import { AuthenticatedSocket } from "./websocket.types.js";
import { verifyWebSocketToken } from "../utils/jwt.js";

export class WebSocketMiddleware {
  static async authenticateSocket(
    socket: AuthenticatedSocket,
    next: NextFunction,
  ) {
    try {
      // Try to get token from different locations
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      // Use the WebSocket-specific token verification
      const decoded = await verifyWebSocketToken(token);

      socket.userId = decoded.user_id;
      socket.userRole = decoded.role_id.toString();

      next();
    } catch (error: any) {
      console.error("WebSocket authentication error:", error.message);
      next(new Error(`Authentication error: ${error.message}`));
    }
  }

  static async rateLimit(
    socket: AuthenticatedSocket,
    event: string,
    next: NextFunction,
  ) {
    try {
      const now = Date.now();

      // Simple rate limiting - allow 10 events per minute per user per event type
      const lastEvent = socket.data.lastEvent || {};
      const eventCount = socket.data.eventCount || {};

      if (!lastEvent[event] || now - lastEvent[event] > 60000) {
        // Reset counter if more than 1 minute has passed
        eventCount[event] = 1;
        lastEvent[event] = now;
      } else {
        eventCount[event]++;
      }

      socket.data.lastEvent = lastEvent;
      socket.data.eventCount = eventCount;

      if (eventCount[event] > 10) {
        return next(new Error(`Rate limit exceeded for event: ${event}`));
      }

      next();
    } catch (error) {
      next(new Error("Rate limiting error"));
    }
  }
}
