import cors from "cors";
import { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { sharedCorsOptions } from "../utils/corsConfig.js";
import { WebSocketMiddleware } from "./websocket.middleware.js";
import { AuthenticatedSocket } from "./websocket.types.js";
import { SystemEventHandler } from "./websocket.handlers.js";

export const corsConfig = cors(sharedCorsOptions);

class WebSocketServer {
  private io!: SocketServer;
  private connectedUsers = new Map<number, Set<string>>();

  constructor(server: HttpServer) {
    this.initializeSocketServer(server);
    this.initializeMiddleware();
    this.initializeHandlers();
  }

  private initializeSocketServer(server: HttpServer) {
    this.io = new SocketServer(server, {
      cors: {
        ...sharedCorsOptions,
        allowedHeaders: ["Authorization", "Content-Type"],
      },
      transports: ["websocket", "polling"],
    });
  }

  private initializeMiddleware() {
    this.io.use(WebSocketMiddleware.authenticateSocket as any);

    // Rate limiting middleware for specific events
    this.io.use((socket: AuthenticatedSocket, next) => {
      socket.data = socket.data || {};
      next();
    });
  }

  private initializeHandlers() {
    this.io.on("connection", (socket: AuthenticatedSocket) => {
      this.registerSocket(socket);
      // System events
      SystemEventHandler.handleConnection(socket);

      socket.on("join_room", (room: string) => {
        socket.join(room);
        console.log(`Socket ${socket.id} joined room: ${room}`);
      });

      // System events
      socket.on("disconnect", () =>
        SystemEventHandler.handleDisconnection(socket),
      );

      socket.on("error", (error) =>
        SystemEventHandler.handleError(socket, error),
      );
    });
  }

  private async handleWithErrorHandling(
    socket: AuthenticatedSocket,
    handler: () => Promise<void>,
  ) {
    try {
      await WebSocketMiddleware.rateLimit(socket, "event", (err) => {
        if (err) throw err;
      });

      await handler();
    } catch (error: any) {
      SystemEventHandler.handleError(socket, error);
    }
  }

  private registerSocket(socket: AuthenticatedSocket) {
    const userId = socket.userId;
    if (!userId) return;

    const sockets = this.connectedUsers.get(userId) || new Set<string>();
    sockets.add(socket.id);
    this.connectedUsers.set(userId, sockets);

    console.log(`User ${userId} connected with socket ${socket.id}`);
  }

  private unregisterSocket(socket: AuthenticatedSocket) {
    const userId = socket.userId;
    if (!userId) return;

    const sockets = this.connectedUsers.get(userId);
    if (!sockets) return;

    sockets.delete(socket.id);
    if (sockets.size === 0) this.connectedUsers.delete(userId);

    console.log(`Socket ${socket.id} disconnected for user ${userId}`);
  }

  // Public methods for external use
  public sendNotification(userId: number, notification: any) {
    const socketIds = this.connectedUsers.get(userId);
    if (!socketIds || socketIds.size === 0) {
      return;
    }

    socketIds.forEach((id) => {
      this.io.to(id).emit("notification", {
        ...notification,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date(),
        read: false,
      });
    });

    // console.log(`Notification sent to user ${userId}`, notification);
  }

  public broadcastToRoom(room: string, event: string, data: any) {
    this.io.to(room).emit(event, data);
  }

  public getConnectedUsers(): number[] {
    return Array.from(this.connectedUsers.keys());
  }

  public getIO(): SocketServer {
    return this.io;
  }
}

export default WebSocketServer;
