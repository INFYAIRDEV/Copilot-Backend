import cors from "cors";

// Comma-separated list in .env, e.g. CORS_ORIGINS=http://localhost:5173,http://localhost:3000
const defaultOrigins = [
  "http://localhost:5173", // Vite dev server
  "http://localhost:3000",
  "http://localhost:8081",
];

const origins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : defaultOrigins;

export const sharedCorsOptions = {
  origin: origins,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept-Language"],
  exposedHeaders: ["Content-Language"],
  credentials: true,
};

export const corsConfig = cors(sharedCorsOptions);
