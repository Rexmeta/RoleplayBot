import { describe, it, expect } from 'vitest';
import {
  validateGeminiToolDeclarations,
  assertValidGeminiTools,
  type FunctionDeclaration,
} from '../../server/services/simulation/validateGeminiTools';
import { SIMULATION_TOOLS } from '../../server/services/simulation/simulationTools';

describe('SIMULATION_TOOLS Gemini API compliance', () => {
  it('passes validation with no errors', () => {
    const errors = validateGeminiToolDeclarations(SIMULATION_TOOLS as FunctionDeclaration[]);
    if (errors.length > 0) {
      const lines = errors.map(e => `[${e.tool}] ${e.path}: ${e.message}`);
      throw new Error(`Unexpected validation errors:\n${lines.join('\n')}`);
    }
    expect(errors).toHaveLength(0);
  });

  it('assertValidGeminiTools does not throw for SIMULATION_TOOLS', () => {
    expect(() =>
      assertValidGeminiTools(SIMULATION_TOOLS as FunctionDeclaration[]),
    ).not.toThrow();
  });

  it('each tool has a non-empty name', () => {
    for (const tool of SIMULATION_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe('string');
    }
  });

  it('all string-type fields with enums have only string enum values', () => {
    const errors = validateGeminiToolDeclarations(SIMULATION_TOOLS as FunctionDeclaration[]);
    const enumErrors = errors.filter(e => e.message.includes('Enum value'));
    expect(enumErrors).toHaveLength(0);
  });
});

describe('validateGeminiToolDeclarations — unit tests', () => {
  it('accepts a minimal valid tool', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'do_something',
        description: 'Does something.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'A message.' },
          },
          required: ['message'],
        },
      },
    ];
    expect(validateGeminiToolDeclarations(tools)).toHaveLength(0);
  });

  it('accepts string enum on a string-type field', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'set_status',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'pending'],
            },
          },
          required: ['status'],
        },
      },
    ];
    expect(validateGeminiToolDeclarations(tools)).toHaveLength(0);
  });

  it('rejects numeric enum values on a string-type field (the pressureDelta class of bug)', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'bad_tool',
        parameters: {
          type: 'object',
          properties: {
            delta: {
              type: 'string',
              enum: [-1, 0, 1] as unknown as string[],
            },
          },
          required: ['delta'],
        },
      },
    ];
    const errors = validateGeminiToolDeclarations(tools);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message.includes('not a string'))).toBe(true);
  });

  it('rejects an enum placed on a non-string type field', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'bad_tool',
        parameters: {
          type: 'object',
          properties: {
            level: {
              type: 'number',
              enum: ['low', 'medium', 'high'],
            },
          },
        },
      },
    ];
    const errors = validateGeminiToolDeclarations(tools);
    expect(errors.some(e => e.message.includes('only valid on TYPE_STRING'))).toBe(true);
  });

  it('rejects an invalid property type', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'bad_tool',
        parameters: {
          type: 'object',
          properties: {
            count: { type: 'float' },
          },
        },
      },
    ];
    const errors = validateGeminiToolDeclarations(tools);
    expect(errors.some(e => e.message.includes('Invalid type'))).toBe(true);
  });

  it('rejects a required field that is not in properties', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'bad_tool',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name', 'missing_field'],
        },
      },
    ];
    const errors = validateGeminiToolDeclarations(tools);
    expect(errors.some(e => e.message.includes('"missing_field"') && e.message.includes('not defined in properties'))).toBe(true);
  });

  it('rejects an empty enum array', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'bad_tool',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: [] },
          },
        },
      },
    ];
    const errors = validateGeminiToolDeclarations(tools);
    expect(errors.some(e => e.message.includes('non-empty array'))).toBe(true);
  });

  it('assertValidGeminiTools throws with a descriptive message when errors exist', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'bad_tool',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string', enum: [1, 2] as unknown as string[] },
          },
        },
      },
    ];
    expect(() => assertValidGeminiTools(tools)).toThrowError(
      /Gemini tool declaration validation failed/,
    );
  });

  it('validates nested object schemas recursively', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'nested_tool',
        parameters: {
          type: 'object',
          properties: {
            outer: {
              type: 'object',
              properties: {
                inner: {
                  type: 'string',
                  enum: [99] as unknown as string[],
                },
              },
            },
          },
        },
      },
    ];
    const errors = validateGeminiToolDeclarations(tools);
    expect(errors.some(e => e.message.includes('not a string'))).toBe(true);
  });

  it('validates array item schemas', () => {
    const tools: FunctionDeclaration[] = [
      {
        name: 'array_tool',
        parameters: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'unknowntype' },
            },
          },
        },
      },
    ];
    const errors = validateGeminiToolDeclarations(tools);
    expect(errors.some(e => e.message.includes('Invalid type'))).toBe(true);
  });
});
