import { z, RefinementCtx } from "zod";
import { getTranslator } from "../translation/i18n.js";

// Type of issue Zod v4 passes into ctx.addIssue
type ZodIssue = Parameters<RefinementCtx["addIssue"]>[0];

export function createZodWithI18n(lang = "en") {
  const t = getTranslator(lang);

  return new Proxy(z, {
    get(target, prop) {
      const original = (target as any)[prop];

      if (typeof original !== "function") return original;

      // wrap constructors
      return (...args: any[]) => {
        const schema = original.apply(target, args);

        return schema.superRefine((value: unknown, ctx: RefinementCtx) => {
          const oldAddIssue = ctx.addIssue.bind(ctx);

          ctx.addIssue = (issue: ZodIssue) => {
            if (typeof issue === "string") {
              return oldAddIssue(issue);
            }

            console.log("issue code", ctx);

            const key = `validation.${issue.code}`;

            const translated = t(key, {
              ...issue,
              path: issue.path?.join(".") ?? "",
            });

            return oldAddIssue({
              ...issue,
              message: translated,
            });
          };
        });
      };
    },
  });
}
