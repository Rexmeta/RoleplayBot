import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Native chat has loading, error and ending exits. Hooks must run before ALL
// of them, even though Tavus-only rendering tests do not mount native chat.
function findCalls(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  if (ts.isFunctionLike(node)) return [];
  const result = predicate(node) ? [node] : [];
  ts.forEachChild(node, child => { result.push(...findCalls(child, predicate)); });
  return result;
}

function hooksAfterExit(source: string): string[] {
  const file = ts.createSourceFile("ChatWindow.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = file.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "StandardChatWindow",
  );
  if (!component?.body) throw new Error("StandardChatWindow was not found");
  const statements = [...component.body.statements];
  const exit = statements.findIndex(statement => findCalls(statement, ts.isReturnStatement).length > 0);
  if (exit < 0) return [];
  return statements.slice(exit + 1).flatMap(statement =>
    findCalls(statement, node => ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) && /^use[A-Z0-9]/.test(node.expression.text))
      .map(node => node.getText(file)),
  );
}

describe("native chat hook order", () => {
  it("keeps hooks before loading/error/ending exits in the real component", () => {
    const source = readFileSync("client/src/components/ChatWindow.tsx", "utf8");
    expect(hooksAfterExit(source)).toEqual([]);
  });
  it("detects the loading-to-loaded regression without treating callback returns as component exits", () => {
    expect(hooksAfterExit(`function StandardChatWindow() {
      useEffect(() => { return () => {}; }, []);
      if (!conversation) return <div>Loading</div>;
      const config = useQuery({ queryKey: ["config"] });
      return <div />;
    }`)).toEqual(['useQuery({ queryKey: ["config"] })']);
  });
});
