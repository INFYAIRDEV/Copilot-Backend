import { z } from "zod";
import { AIJsonSchema } from "../types/ai-provider.types.js";
import { OutputSchemaDefinition } from "./structured-output.types.js";

export class OutputSchemaException extends Error {
  constructor(
    public readonly code:
      "AI_OUTPUT_SCHEMA_NOT_FOUND" | "AI_OUTPUT_SCHEMA_INVALID",
    message: string,
    public readonly schemaId?: string,
  ) {
    super(message);
    this.name = "OutputSchemaException";
  }
}

function requiredShape(value: z.ZodTypeAny): {
  schema: z.ZodTypeAny;
  required: boolean;
} {
  if (value instanceof z.ZodOptional || value instanceof z.ZodDefault) {
    return {
      schema:
        value instanceof z.ZodOptional ? value.unwrap() : value.removeDefault(),
      required: false,
    };
  }
  return { schema: value, required: true };
}

function providerSchemaFor(value: z.ZodTypeAny, depth = 0): AIJsonSchema {
  if (depth > 8) {
    throw new OutputSchemaException(
      "AI_OUTPUT_SCHEMA_INVALID",
      "Output schema exceeds the provider's supported nesting depth",
    );
  }
  const schema: AIJsonSchema = {};
  if (value.description) schema.description = value.description;

  if (value instanceof z.ZodString) {
    schema.type = "string";
    return schema;
  }
  if (value instanceof z.ZodNumber) {
    schema.type = "number";
    for (const check of value._def.checks) {
      if (check.kind === "int") schema.type = "integer";
      if (check.kind === "min" || check.kind === "max") {
        if (check.inclusive === false) {
          throw new OutputSchemaException(
            "AI_OUTPUT_SCHEMA_INVALID",
            "Exclusive numeric bounds are not supported by the configured provider",
          );
        }
        if (check.kind === "min") schema.minimum = check.value;
        if (check.kind === "max") schema.maximum = check.value;
      }
    }
    return schema;
  }
  if (value instanceof z.ZodEnum) {
    schema.type = "string";
    schema.enum = [...value.options];
    return schema;
  }
  if (value instanceof z.ZodBoolean) {
    schema.type = "boolean";
    return schema;
  }
  if (value instanceof z.ZodArray) {
    schema.type = "array";
    schema.items = providerSchemaFor(value.element, depth + 1);
    return schema;
  }
  if (value instanceof z.ZodObject) {
    schema.type = "object";
    schema.properties = {};
    schema.required = [];
    const shape = value.shape as Record<string, z.ZodTypeAny>;
    for (const [key, field] of Object.entries(shape)) {
      const normalized = requiredShape(field);
      schema.properties[key] = providerSchemaFor(normalized.schema, depth + 1);
      if (normalized.required) schema.required.push(key);
    }
    schema.additionalProperties = value._def.unknownKeys === "passthrough";
    return schema;
  }
  throw new OutputSchemaException(
    "AI_OUTPUT_SCHEMA_INVALID",
    "Output schema uses a Zod feature unsupported by the configured provider",
  );
}

export function defineOutputSchema<T>(definition: {
  id: string;
  name: string;
  description: string;
  promptKey: string;
  schema: z.ZodType<T>;
}): OutputSchemaDefinition<T> {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.id)) {
    throw new OutputSchemaException(
      "AI_OUTPUT_SCHEMA_INVALID",
      "Invalid output schema identifier",
      definition.id,
    );
  }
  const providerSchema = providerSchemaFor(definition.schema);
  if (JSON.stringify(providerSchema).length > 12000) {
    throw new OutputSchemaException(
      "AI_OUTPUT_SCHEMA_INVALID",
      "Output schema exceeds the provider's supported size",
      definition.id,
    );
  }
  return Object.freeze({ ...definition, providerSchema });
}

export class OutputSchemaRegistry {
  private readonly schemas = new Map<string, OutputSchemaDefinition<unknown>>();

  public register<T>(definition: OutputSchemaDefinition<T>): void {
    if (this.schemas.has(definition.id)) {
      throw new OutputSchemaException(
        "AI_OUTPUT_SCHEMA_INVALID",
        "Duplicate output schema identifier",
        definition.id,
      );
    }
    this.schemas.set(definition.id, {
      ...definition,
      schema: definition.schema as unknown as z.ZodType<unknown>,
    });
  }

  public has(id: string): boolean {
    return this.schemas.has(id);
  }

  public assertRegistered<T>(definition: OutputSchemaDefinition<T>): void {
    const registered = this.schemas.get(definition.id);
    if (!registered) {
      throw new OutputSchemaException(
        "AI_OUTPUT_SCHEMA_NOT_FOUND",
        "Unknown output schema identifier",
        definition.id,
      );
    }
    if (registered.schema !== definition.schema) {
      throw new OutputSchemaException(
        "AI_OUTPUT_SCHEMA_INVALID",
        "Output schema identifier does not match the registered schema",
        definition.id,
      );
    }
  }
}
