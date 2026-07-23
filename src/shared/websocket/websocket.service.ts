import { Server as HttpServer } from "http";
import WebSocketServer from "./websocket.server.js";

class WebSocketService {
  private static instance: WebSocketServer;

  static initialize(server: HttpServer): WebSocketServer {
    if (!this.instance) {
      this.instance = new WebSocketServer(server);
      console.log("WebSocket server initialized");
    }
    return this.instance;
  }

  static getInstance(): WebSocketServer {
    if (!this.instance) {
      throw new Error("WebSocket server not initialized");
    }
    return this.instance;
  }

  static sendNotification(userId: number, notification: any): void {
    try {
      this.getInstance().sendNotification(userId, notification);
    } catch (error) {
      console.error("Failed to send notification:", error);
    }
  }
}

export default WebSocketService;
