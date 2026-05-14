const VALID_GEMINI_TYPES = new Set([
  'string', 'number', 'integer', 'boolean', 'object', 'array',
]);

export interface ValidationError {
  tool: string;
  path: string;
  message: string;
}

function validateSchema(
  schema: Record<string, unknown>,
  path: string,
  toolName: string,
  errors: ValidationError[],
): void {
  const type = schema.type as string | undefined;

  if (type !== undefined && !VALID_GEMINI_TYPES.has(type)) {
    errors.push({
      tool: toolName,
      path,
      message: `Invalid type "${type}". Must be one of: ${[...VALID_GEMINI_TYPES].join(', ')}.`,
    });
  }

  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues !== undefined) {
    if (!Array.isArray(enumValues) || enumValues.length === 0) {
      errors.push({
        tool: toolName,
        path,
        message: 'enum must be a non-empty array.',
      });
    } else {
      if (type !== 'string' && type !== undefined) {
        errors.push({
          tool: toolName,
          path,
          message: `enum is only valid on TYPE_STRING fields, but type is "${type}".`,
        });
      }

      for (let i = 0; i < enumValues.length; i++) {
        const v = enumValues[i];
        if (typeof v !== 'string') {
          errors.push({
            tool: toolName,
            path: `${path}.enum[${i}]`,
            message: `Enum value ${JSON.stringify(v)} is not a string. Gemini requires all enum values to be strings.`,
          });
        }
      }
    }
  }

  if (type === 'object') {
    const properties = schema.properties as Record<string, unknown> | undefined;
    const required = schema.required as string[] | undefined;

    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        validateSchema(
          propSchema as Record<string, unknown>,
          `${path}.properties.${key}`,
          toolName,
          errors,
        );
      }
    }

    if (required) {
      if (!Array.isArray(required)) {
        errors.push({
          tool: toolName,
          path: `${path}.required`,
          message: 'required must be an array.',
        });
      } else {
        for (const field of required) {
          if (!properties || !(field in properties)) {
            errors.push({
              tool: toolName,
              path: `${path}.required`,
              message: `Required field "${field}" is not defined in properties.`,
            });
          }
        }
      }
    }
  }

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      validateSchema(items, `${path}.items`, toolName, errors);
    }
  }
}

export interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export function validateGeminiToolDeclarations(
  tools: FunctionDeclaration[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const tool of tools) {
    if (!tool.name || typeof tool.name !== 'string') {
      errors.push({ tool: String(tool.name), path: 'name', message: 'Tool must have a non-empty string name.' });
      continue;
    }

    if (tool.parameters) {
      validateSchema(tool.parameters, 'parameters', tool.name, errors);
    }
  }

  return errors;
}

export function assertValidGeminiTools(tools: FunctionDeclaration[]): void {
  const errors = validateGeminiToolDeclarations(tools);
  if (errors.length > 0) {
    const lines = errors.map(
      e => `  [${e.tool}] ${e.path}: ${e.message}`,
    );
    throw new Error(
      `Gemini tool declaration validation failed:\n${lines.join('\n')}`,
    );
  }
}
