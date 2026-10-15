// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { workerNames } from "../../../workers/hosted-node/supervise.mjs";
import { NODE_QUEUE_KINDS } from "@/lib/ops/node-queue-observation";

// This census covers the hosted supervisor and the declared standalone GTFS
// poller. A future standalone daemon outside both declarations needs enrollment.
function invokesObserver(source: string, kind: string) {
  const tree = ts.createSourceFile("worker.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imported = tree.statements.some(statement => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === "../../src/lib/ops/node-queue-observation"
    && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(binding => !binding.propertyName && binding.name.text === "observeNodeQueue"));
  let wrappers = 0, direct = 0;
  for (const statement of tree.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isVoidExpression(statement.expression)) continue;
    const outer = statement.expression.expression;
    if (!ts.isCallExpression(outer) || !ts.isPropertyAccessExpression(outer.expression) || outer.expression.name.text !== "catch") continue;
    const call = outer.expression.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
    if (call.expression.text === "main") direct++;
    if (call.expression.text === "observeNodeQueue" && call.arguments.length === 2
      && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === kind
      && ts.isIdentifier(call.arguments[1]) && call.arguments[1].text === "main") wrappers++;
  }
  return imported && wrappers === 1 && direct === 0;
}

function notifiesFromWorkerHandlers(source: string) {
  const tree = ts.createSourceFile("worker.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const main = tree.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === "main");
  if (!main || !ts.isFunctionDeclaration(main) || !main.body || main.parameters.length !== 1
    || !ts.isIdentifier(main.parameters[0].name) || main.parameters[0].name.text !== "noticeStopping") return false;
  const arrows = new Map<string, ts.ArrowFunction>();
  const scan = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) arrows.set(node.name.text,node.initializer);
    ts.forEachChild(node,scan);
  };
  scan(main.body);
  const observed = new Set<string>();
  const calls = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(tree) === "process"
      && node.expression.name.text === "on" && ts.isStringLiteral(node.arguments[0]) && ["SIGINT","SIGTERM"].includes(node.arguments[0].text)) {
      const argument = node.arguments[1];
      const handler = ts.isArrowFunction(argument) ? argument : ts.isIdentifier(argument) ? arrows.get(argument.text) : undefined;
      if (handler && ts.isBlock(handler.body) && handler.body.statements.some(statement => ts.isExpressionStatement(statement)
        && ts.isCallExpression(statement.expression) && ts.isIdentifier(statement.expression.expression)
        && statement.expression.expression.text === "noticeStopping" && statement.expression.arguments.length === 0)) observed.add(node.arguments[0].text);
    }
    ts.forEachChild(node,calls);
  };
  calls(main.body); return observed.size === 2;
}

describe("Node queue observation entry points", () => {
  it("keeps its registry aligned with deployed and standalone queues", () => {
    expect([...NODE_QUEUE_KINDS].sort(), "Observation registry must cover declared queue workers")
      .toEqual([...workerNames, "gtfs-ingestion"].sort());
  });
  it("invokes the observer at every actual declared entry point", () => {
    for (const kind of [...workerNames, "gtfs-ingestion"]) {
      const source = readFileSync(path.join(process.cwd(), "scripts/workers", `${kind}.ts`), "utf8");
      expect(invokesObserver(source, kind), `Queue ${kind} must invoke its observer around main`).toBe(true);
    }
  });
  it("keeps stopping notification inside each worker signal handler", () => {
    for (const kind of [...workerNames, "gtfs-ingestion"]) {
      const source = readFileSync(path.join(process.cwd(), "scripts/workers", `${kind}.ts`), "utf8");
      expect(notifiesFromWorkerHandlers(source), `Queue ${kind} must notify from its actual stop handlers`).toBe(true);
    }
  });

});
