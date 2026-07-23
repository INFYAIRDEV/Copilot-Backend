// src/shared/utils/response.ts
import { Response, Request } from "express";
import { getTranslator } from "../translation/i18n.js";

interface SuccessResponse {
  success?: boolean;
  message?: string;
  messageKey?: string;
  messageParams?: any;
  staticModule?: string;
  data?: any;
  statusCode?: number;
}

interface ErrorResponse {
  success?: boolean;
  message?: string;
  messageKey?: string;
  messageParams?: any;
  error?: any;
  statusCode?: number;
  code?: string;
  context?: Record<string, any>;

  data?: any;
}

export class ApiResponse {
  // Success Response
  static success(res: Response, data: SuccessResponse) {
    const req = (res as any).req as Request | undefined;
    const lang = ((req as any)?.lang || "en") as string;
    const t = getTranslator(lang);

    // Resolve params: allow passing translation keys (e.g., 'entity.article')
    const resolvedParams = data.messageParams
      ? Object.fromEntries(
          Object.entries(data.messageParams).map(([k, v]) => {
            if (typeof v === "string") {
              // First try direct lookup with defaultNS
              let translated = t(v);
              if (translated !== v) return [k, translated];

              if (v.includes(".")) {
                const [nsCandidate, ...rest] = v.split(".");
                const restKey = rest.join(".");
                // Try with explicit namespace and rest key
                if (restKey) {
                  const maybe = t(restKey, { ns: nsCandidate });
                  if (maybe !== restKey) return [k, maybe];
                }
                // Try with explicit namespace and full key
                const maybeFull = t(v, { ns: nsCandidate });
                if (maybeFull !== v) return [k, maybeFull];
              }
              return [k, v];
            }
            return [k, v];
          }),
        )
      : undefined;

    const message =
      data.message ||
      (data.messageKey ? t(data.messageKey, resolvedParams || {}) : "");

    res.setHeader("Content-Language", lang);
    return res.status(data.statusCode || 200).json({
      success: true,
      message,
      data: data.data,
    });
  }

  // Error Response
  static error(res: Response, error: ErrorResponse) {
    const req = (res as any).req as Request | undefined;
    const lang = ((req as any)?.lang || "en") as string;
    const t = getTranslator(lang);

    const resolvedParams = error.messageParams
      ? Object.fromEntries(
          Object.entries(error.messageParams).map(([k, v]) => {
            if (typeof v === "string") {
              let translated = t(v);
              if (translated !== v) return [k, translated];

              if (v.includes(".")) {
                const [nsCandidate, ...rest] = v.split(".");
                const restKey = rest.join(".");
                if (restKey) {
                  const maybe = t(restKey, { ns: nsCandidate });
                  if (maybe !== restKey) return [k, maybe];
                }
                const maybeFull = t(v, { ns: nsCandidate });
                if (maybeFull !== v) return [k, maybeFull];
              }
              return [k, v];
            }
            return [k, v];
          }),
        )
      : undefined;

    const message =
      error.message ||
      (error.messageKey ? t(error.messageKey, resolvedParams || {}) : "");

    res.setHeader("Content-Language", lang);
    return res.status(error.statusCode || 500).json({
      success: false,
      message,
      code: error.code,
      error: error.error,
      data: error.data,
    });
  }

  // Not Found Response
  static notFound(res: Response, message: string = "Resource not found") {
    return res.status(404).json({
      success: false,
      message,
    });
  }

  // Bad Request Response
  static badRequest(res: Response, message: string, errors?: any) {
    return res.status(400).json({
      success: false,
      message,
      errors,
    });
  }

  // Unauthorized Response
  static unauthorized(res: Response, error: ErrorResponse) {
    const req = (res as any).req as Request | undefined;
    const lang = ((req as any)?.lang || "en") as string;
    const t = getTranslator(lang);

    const resolvedParams = error.messageParams
      ? Object.fromEntries(
          Object.entries(error.messageParams).map(([k, v]) => {
            if (typeof v === "string") {
              let translated = t(v);
              if (translated !== v) return [k, translated];

              if (v.includes(".")) {
                const [nsCandidate, ...rest] = v.split(".");
                const restKey = rest.join(".");
                if (restKey) {
                  const maybe = t(restKey, { ns: nsCandidate });
                  if (maybe !== restKey) return [k, maybe];
                }
                const maybeFull = t(v, { ns: nsCandidate });
                if (maybeFull !== v) return [k, maybeFull];
              }
              return [k, v];
            }
            return [k, v];
          }),
        )
      : undefined;

    const message =
      error.message ||
      (error.messageKey ? t(error.messageKey, resolvedParams || {}) : "");

    res.setHeader("Content-Language", lang);
    return res.status(error.statusCode || 401).json({
      success: false,
      message,
      code: error.code,
      error: error.error,
      data: error.data,
    });
  }
}
