import cors from "cors";

export const sharedCorsOptions = {
  origin: ["http://localhost:3000", "http://localhost:8081"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  credentials: true,
};

export const corsConfig = cors(sharedCorsOptions);
