import { Socket } from "socket.io";

export interface AuthenticatedSocket extends Socket {
  userId?: number;
  userRole?: string;
  operatorId?: number;
}

export interface Notification {
  id: string;
  type: "STATUS_UPDATE" | "EXAMPLE_DELETE";
  message: string;
  data: any;
  timestamp: Date;
  read: boolean;
  priority?: "low" | "medium" | "high";
}
