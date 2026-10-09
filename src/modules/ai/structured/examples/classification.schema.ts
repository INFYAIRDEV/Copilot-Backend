import { z } from "zod";
import { defineOutputSchema } from "../structured-output.registry.js";

export const classificationSchema = defineOutputSchema({
  id: "text_classification",
  name: "TextClassification",
  description:
    "Classifies a user-provided text into an approved high-level category.",
  promptKey: "TEXT_CLASSIFICATION",
  schema: z
    .object({
      category: z.enum(["technical", "product", "billing", "general", "other"]),
      confidence: z.number().min(0).max(1),
      summary: z.string().trim().min(1).max(500),
    })
    .strict(),
});

export type TextClassification = z.infer<typeof classificationSchema.schema>;
