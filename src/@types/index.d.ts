import { Users } from "@prisma/client";

export {}; // Important for module augmentation

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Request {
      user?: Users;
      file?: File;
      files?: File[];
      lang?: string;
    }
  }
}
