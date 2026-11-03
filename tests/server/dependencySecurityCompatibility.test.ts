import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { createInsertSchema } from "drizzle-zod";
import { pgTable, text } from "drizzle-orm/pg-core";
import { scenarioOverrideDataSchema } from "../../shared/schema/scenarios";

describe("security dependency compatibility", () => {
  it("rejects an oversized collection before allocating an issue per invalid element", () => {
    const result = z.array(z.string()).max(10).safeParse(Array(10_000).fill(null));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({ code: "too_big", origin: "array", maximum: 10 }),
      ]);
    }
  });

  it("continues accepting partial evaluation-weight overrides without filling missing dimensions", () => {
    expect(scenarioOverrideDataSchema.parse({ evaluationWeights: { empathy: 3 } }))
      .toEqual({ evaluationWeights: { empathy: 3 } });
    expect(scenarioOverrideDataSchema.parse({ evaluationWeights: {} }))
      .toEqual({ evaluationWeights: {} });
  });

  it("continues rejecting unknown dimensions and out-of-range evaluation weights", () => {
    for (const evaluationWeights of [{ unknown: 1 }, { empathy: -1 }, { empathy: 11 }]) {
      expect(scenarioOverrideDataSchema.safeParse({ evaluationWeights }).success).toBe(false);
    }
  });

  it("keeps Drizzle-generated schemas composable with the patched Zod API", () => {
    const table = pgTable("validation_compatibility", {
      name: text("name").notNull(),
      description: text("description"),
    });
    const schema = createInsertSchema(table).extend({ name: z.string().min(1) });
    expect(schema.parse({ name: "Example" })).toEqual({ name: "Example" });
    expect(schema.parse({ name: "Example", description: null })).toEqual({
      name: "Example", description: null,
    });
    expect(schema.safeParse({ name: "" }).success).toBe(false);
  });

  it("keeps form defaults and field errors working through the updated Zod resolver", async () => {
    const schema = z.object({
      email: z.string().email(),
      rememberMe: z.boolean().default(false),
    });
    const resolver = zodResolver(schema);
    const options = { fields: {}, shouldUseNativeValidation: false };
    await expect(resolver({ email: "person@example.com" }, undefined, options)).resolves.toEqual({
      values: { email: "person@example.com", rememberMe: false },
      errors: {},
    });
    const invalid = await resolver({ email: "invalid" }, undefined, options);
    expect(invalid.values).toEqual({});
    expect(invalid.errors.email).toMatchObject({ type: "invalid_format" });
  });
});
