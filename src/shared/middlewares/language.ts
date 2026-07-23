import { Request, Response, NextFunction } from "express";

export const languageMiddleware = (
  req: Request & { lang?: string },
  res: Response,
  next: NextFunction,
) => {
  const headerLang = req.headers["accept-language"];
  const supported = ["en", "it", "hi", "fr"];
  let lang = "en";

  if (headerLang) {
    const short = (headerLang as string).split("-")[0];
    if (supported.includes(short)) lang = short;
  }

  req.lang = lang;
  next();
};
