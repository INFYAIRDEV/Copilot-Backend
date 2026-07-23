import { NotFoundError } from "@/shared/errors/error.js";
import { asyncHandler } from "@/shared/middlewares/responseHandler.js";
import { ApiResponse } from "@/shared/types/response.js";
import { Response, Request } from "express";
import { userValidation } from "./example.validation.js";

export const exampleController = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      /*
      if request method is POST or PUT use Zod validation to validate the requst body

      */

      const { user } = req.user;

      const z = req.zod;
      const schema = userValidation(z);

      const orderValidation = schema.safeParse(req.body);
      const { success, error } = orderValidation;
      if (!success) {
        const errorMessages = error.issues[0].message;

        return ApiResponse.error(res, {
          messageKey: errorMessages,
          statusCode: 400,
        });
      }

      // -- Perform Action based on request from
      return ApiResponse.success(res, {
        messageKey: "common.successResponse",
        statusCode: 200,
        data: {
          user: {
            name: "INFYAIR",
          },
        },
      });
    } catch (error: any) {
      if (error instanceof NotFoundError) {
        return ApiResponse.error(res, {
          messageKey: "common.notFound", // -- Proper meaningful error messages --
          statusCode: 404,
        });
      }

      return ApiResponse.error(res, {
        messageKey: "common.serverIssue", // -- Generic messages --
        statusCode: 500,
      });
    }
  },
);
