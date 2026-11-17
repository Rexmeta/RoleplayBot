import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

describe("fast-xml-parser security compatibility", () => {
  it("still validates and round-trips XML with attributes and entities", () => {
    const options = { ignoreAttributes: false };
    const xml = '<root id="example"><name>A &amp; B</name></root>';
    const parser = new XMLParser(options);
    const parsed = parser.parse(xml);

    expect(XMLValidator.validate(xml)).toBe(true);
    expect(parsed).toEqual({ root: { "@_id": "example", name: "A & B" } });
    expect(parser.parse(new XMLBuilder(options).build(parsed))).toEqual(parsed);
  });

  it("preserves raw content in a valid stop node", () => {
    const parser = new XMLParser({ stopNodes: ["root.stop"] });
    expect(parser.parse("<root><stop><a>raw &amp; content</a></stop></root>"))
      .toEqual({ root: { stop: "<a>raw &amp; content</a>" } });
  });

  it("rejects unterminated stop-node tags without quadratic scanning", () => {
    // Isolate the advisory payload so a vulnerable parser cannot hang the test runner.
    const script = `
      import { XMLParser } from "fast-xml-parser";
      import assert from "node:assert/strict";
      const parser = new XMLParser({ stopNodes: ["stop"] });
      assert.throws(() => parser.parse("<stop>" + "<a ".repeat(100_000)));
    `;
    expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      timeout: 3_000,
      stdio: "pipe",
    })).not.toThrow();
  }, 10_000);
});
