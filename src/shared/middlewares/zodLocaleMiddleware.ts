import { Request, Response, NextFunction } from "express";
import { createZodWithI18n } from "../utils/errorMap.js";

declare module "express-serve-static-core" {
  interface Request {
    zod: ReturnType<typeof createZodWithI18n>;
  }
}

export function zodLocaleMiddleware(
  req: Request & { lang?: string },
  res: Response,
  next: NextFunction,
) {
  const lang = req.lang || "en";

  req.zod = createZodWithI18n(lang);

  next();
}
