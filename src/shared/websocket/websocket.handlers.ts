import { Socket } from "socket.io";
import { prisma } from "../utils/prismaClient.js";
import { AuthenticatedSocket, Notification } from "./websocket.types.js";

//room handling
export class SystemEventHandler {
  static handleConnection(socket: AuthenticatedSocket) {
    try {
      console.log(`User ${socket.userId} connected`);

      // Join appropriate rooms
      if (socket.userRole === "admin" || socket.userRole === "manager") {
        socket.join("admin-room");
      } else if (socket.userRole === "operator") {
        socket.join("operator-room");
      }

      socket.emit("connected", {
        userId: socket.userId,
        userRole: socket.userRole,
        timestamp: new Date(),
      });
    } catch (error: any) {
      throw new Error(`Connection handling failed: ${error.message}`);
    }
  }

  static handleDisconnection(socket: AuthenticatedSocket) {
    try {
      console.log(`User ${socket.userId} disconnected`);

      if (socket.userRole === "operator") {
        WebSocketNotificationHandler.sendAdminNotification(
          {
            type: "STATUS_UPDATE",
            message: `Operator ${socket.userId} went offline`,
            data: { operatorId: socket.userId, status: "offline" },
            timestamp: new Date(),
          },
          socket,
        );
      }
    } catch (error) {
      console.error("Disconnection handling error:", error);
    }
  }

  static handleError(socket: AuthenticatedSocket, error: Error) {
    console.error(`Socket error for user ${socket.userId}:`, error);
    socket.emit("error", {
      code: "INTERNAL_ERROR",
      message: error.message,
      timestamp: new Date(),
    });
  }
}

export class WebSocketNotificationHandler {
  static sendAdminNotification(
    notification: Omit<Notification, "id" | "read">,
    socket: Socket,
  ) {
    const fullNotification: Notification = {
      ...notification,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      read: false,
    };

    socket.to("admin-room").emit("notification", fullNotification);
  }

  static sendManagerNotification(
    notification: Omit<Notification, "id" | "read">,
    socket: Socket,
  ) {
    const fullNotification: Notification = {
      ...notification,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      read: false,
    };

    socket.to("manager-room").emit("notification", fullNotification);
  }
}
