import { classificationSchema } from "./examples/classification.schema.js";
import { OutputSchemaRegistry } from "./structured-output.registry.js";

export const defaultOutputSchemaRegistry = new OutputSchemaRegistry();
defaultOutputSchemaRegistry.register(classificationSchema);
