export class APIResponse extends Error {
  public messageKey: string;
  public statusCode: number;
  public messageParams?: Record<string, any>;
  public data?: any;

  constructor(
    messageKey: string,
    statusCode: number = 500,
    messageParams?: Record<string, any>,
    data?: any,
  ) {
    super(messageKey);
    this.messageKey = messageKey;
    this.statusCode = statusCode;
    this.messageParams = messageParams;
    this.data = data;

    this.name = "APIResponse";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class CreateSuccess extends APIResponse {
  constructor(message: string, data?: any) {
    super(message, 201, data);
  }
}

export class UpdateSuccess extends APIResponse {
  constructor(message: string) {
    super(message, 200);
  }
}

export class DeleteSuccess extends APIResponse {
  constructor(message: string) {
    super(message, 200);
  }
}

export class GetSuccess extends APIResponse {
  constructor(message: string) {
    super(message, 200);
  }
}

export class UnauthorizedError extends APIResponse {
  constructor(message: string) {
    super(message, 401);
  }
}

export class ForbiddenError extends APIResponse {
  constructor(message: string) {
    super(message, 403);
  }
}

export class NotFoundError extends APIResponse {
  constructor(messageKey: string, messageParams?: Record<string, any>) {
    super(messageKey, 404, messageParams);
    this.name = "BadRequestError";
  }
}

export class ConflictError extends APIResponse {
  constructor(message: string) {
    super(message, 409);
  }
}

export class InternalServerError extends APIResponse {
  constructor(message: string) {
    super(message, 500);
  }
}

export class BadRequestError extends APIResponse {
  constructor(messageKey: string, messageParams?: Record<string, any>) {
    super(messageKey, 400, messageParams);
    this.name = "BadRequestError";
  }
}

export class ExcelImportError extends APIResponse {
  constructor(messageKey: string, messageParams?: Record<string, any>) {
    super(messageKey, 400, messageParams);
    this.name = "ExcelImportError";
  }
}

export class ExcelInvalidFormat extends APIResponse {
  constructor(messageKey: string, messageParams?: Record<string, any>) {
    super(messageKey, 400, messageParams);
    this.name = "ExcelInvalidFormat";
  }
}
