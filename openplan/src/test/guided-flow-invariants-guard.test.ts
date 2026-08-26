/**
 * Every guided flow in the repository obeys the primitive's contract — read out
 * of the SOURCE, never out of a list of filenames kept here.
 *
 * WHY IT IS DERIVED. A hand-written list of surfaces is how a fourth blank map
 * hid from its own guard: the list is edited by whoever remembers, and the
 * whole failure mode is not remembering. So this file starts from "every .tsx
 * under src/ that imports the primitive" and has no opinion about which files
 * those are. Adding a flow puts it under this guard with no edit here; the only
 * way out is not to use the primitive, which the last check makes visible too.
 *
 * WHAT IT CANNOT SEE, and what covers that instead:
 *   - whether a control is actually RENDERED for a declared field. Source text
 *     cannot know what a `render` function paints, so `<GuidedFlow>` checks it
 *     at runtime and throws outside production; the throw itself is tested in
 *     `guided-flow-primitive.test.tsx`.
 *   - anything about layout, focus or modality. jsdom has no box model and
 *     applies no stylesheet; those are browser measurements.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/source-text";

const SRC = path.resolve(__dirname, "..");
const PRIMITIVE = "@/components/ui/guided-flow";

function everyTsxFile(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".claude") continue;
      everyTsxFile(full, found);
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

const ALL_TSX = everyTsxFile(SRC).filter((file) => !file.startsWith(path.join(SRC, "test")));

function parse(file: string) {
  const raw = readFileSync(file, "utf8");
  // A comment is a paragraph ABOUT the code, and letting one reach a matcher
  // has broken guards here five times — in both directions. Every text check
  // below reads `code`; only the AST reads the raw file, which is correct
  // because the parser already knows what a comment is.
  const text = stripSourceComments(raw);
  return {
    text,
    rel: path.relative(SRC, file),
    source: ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  };
}

const PARSED = ALL_TSX.map(parse);

/** Files that build a flow on the primitive. The guard's whole subject. */
const FLOW_FILES = PARSED.filter((file) =>
  file.source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === PRIMITIVE
  )
);

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * `{ steps }` and `{ steps: steps }` are the same option. Reading only the
 * second form is how this guard first read ZERO steps out of the flow it was
 * written against and passed anyway — found by mutating the flow, not by
 * reading the guard.
 */
function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const member of object.properties) {
    if (
      ts.isPropertyAssignment(member) &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
      member.name.text === name
    ) {
      return member.initializer;
    }
    if (ts.isShorthandPropertyAssignment(member) && member.name.text === name) {
      return member.name;
    }
  }
  return null;
}

/** `const X = {…}` in the same file, so `initialValues: INITIAL_VALUES` resolves. */
function resolve(expression: ts.Expression, source: ts.SourceFile): ts.Expression {
  if (!ts.isIdentifier(expression)) return expression;
  let resolved: ts.Expression = expression;
  walk(source, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === (expression as ts.Identifier).text &&
      node.initializer
    ) {
      resolved = node.initializer;
    }
  });
  return resolved;
}

/**
 * The node that actually holds a flow's step literals. `steps` is written three
 * ways in practice — an array inline, a `const` beside the component, or a
 * `useMemo(() => [...])` — and all three have to resolve, or the guard quietly
 * reads nothing and passes.
 */
function stepsSource(expression: ts.Expression, source: ts.SourceFile): ts.Node {
  const resolved = resolve(expression, source);
  if (ts.isCallExpression(resolved) && resolved.arguments.length > 0) {
    const factory = resolved.arguments[0];
    if (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory)) {
      const body = factory.body;
      return ts.isParenthesizedExpression(body) ? body.expression : body;
    }
  }
  return resolved;
}

/** Read literal keys through object spreads such as `{ ...DEFAULTS, projectId }`. */
function initialValueKeysFor(
  expression: ts.Expression,
  source: ts.SourceFile,
  seen = new Set<string>()
): string[] {
  const resolved = stepsSource(expression, source);
  if (!ts.isObjectLiteralExpression(resolved)) return [];

  return resolved.properties.flatMap((member) => {
    if (
      ts.isPropertyAssignment(member) &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
    ) {
      return [member.name.text];
    }
    if (ts.isShorthandPropertyAssignment(member)) return [member.name.text];
    if (ts.isSpreadAssignment(member)) {
      const marker = member.expression.getText(source);
      if (seen.has(marker)) return [];
      seen.add(marker);
      return initialValueKeysFor(member.expression, source, seen);
    }
    return [];
  });
}

function literalString(expression: ts.Expression | null): string | null {
  if (!expression) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  return null;
}

type DeclaredField = { name: string; required: boolean; stepId: string };

type Flow = {
  rel: string;
  text: string;
  id: string;
  /** The JSX each step paints. The only place "inside the flow" is decidable. */
  renderBodies: ts.Node[];
  initialValueKeys: string[];
  fields: DeclaredField[];
  stepsWithoutFields: string[];
};

/**
 * A step is an object literal carrying `id`, `title` and `render` — the three
 * the type demands. Finding them structurally rather than by following the
 * `steps` property means a flow that builds its steps in a `useMemo`, a helper,
 * or a conditional is read exactly the same way.
 */
function readFlows(file: (typeof PARSED)[number]): Flow[] {
  const flows: Flow[] = [];
  walk(file.source, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression) || node.expression.text !== "useGuidedFlow") return;
    const options = node.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return;

    const id = literalString(property(options, "id")) ?? "<not a literal>";

    const initial = property(options, "initialValues");
    // Same three spellings as `steps`, and the same reason for handling all
    // three: a shape this cannot read makes the "no answer the flow cannot
    // hold" check pass by seeing nothing.
    const initialValueKeys = initial ? initialValueKeysFor(initial, file.source) : [];

    // Only THIS flow's steps. A file may build several flows (the record
    // composers build one per record type), and reading the whole file for
    // every flow would blame each flow for its neighbours' fields.
    const stepsProperty = property(options, "steps");
    const stepsRoot = stepsProperty ? stepsSource(stepsProperty, file.source) : null;

    const fields: DeclaredField[] = [];
    const stepsWithoutFields: string[] = [];
    const renderBodies: ts.Node[] = [];
    walk(stepsRoot ?? options, (candidate) => {
      if (!ts.isObjectLiteralExpression(candidate)) return;
      const stepId = literalString(property(candidate, "id"));
      if (!stepId || !property(candidate, "title") || !property(candidate, "render")) return;
      const render = property(candidate, "render");
      if (render && (ts.isArrowFunction(render) || ts.isFunctionExpression(render))) {
        renderBodies.push(render.body);
      }
      const declared = property(candidate, "fields");
      if (!declared || !ts.isArrayLiteralExpression(declared)) {
        stepsWithoutFields.push(stepId);
        return;
      }
      for (const element of declared.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        const name = literalString(property(element, "name"));
        if (!name) continue;
        const required = property(element, "required");
        fields.push({
          name,
          required: required?.kind === ts.SyntaxKind.TrueKeyword,
          stepId,
        });
      }
    });

    flows.push({
      rel: file.rel,
      text: file.text,
      id,
      renderBodies,
      initialValueKeys,
      fields,
      stepsWithoutFields,
    });
  });
  return flows;
}

const FLOWS = FLOW_FILES.flatMap(readFlows);

describe("every guided flow, found by its import rather than by a list kept here", () => {
  it("finds the flows at all — a guard whose subject is empty proves nothing", () => {
    expect(FLOW_FILES.length).toBeGreaterThan(0);
    expect(FLOWS.length).toBeGreaterThan(0);
    for (const flow of FLOWS) {
      expect(flow.id, `${flow.rel} passes a non-literal flow id`).not.toBe("<not a literal>");
      // A flow whose steps or initialValues this file cannot read is a flow it
      // silently exempts. Fail on that rather than pass by seeing nothing.
      expect(flow.fields.length, `${flow.rel} (flow "${flow.id}"): no fields were readable`).toBeGreaterThan(0);
      expect(
        flow.initialValueKeys.length,
        `${flow.rel} (flow "${flow.id}"): initialValues did not resolve to an object literal`
      ).toBeGreaterThan(0);
    }
  });

  it("declares every step's answers as data, so validation never depends on what is mounted", () => {
    const offenders = FLOWS.flatMap((flow) =>
      flow.stepsWithoutFields.map((stepId) => `${flow.rel}: step "${stepId}" declares no fields[]`)
    );
    expect(offenders).toEqual([]);
  });

  it("declares no answer the flow cannot hold, and none twice", () => {
    const offenders: string[] = [];
    for (const flow of FLOWS) {
      const seen = new Set<string>();
      for (const field of flow.fields) {
        if (seen.has(field.name)) {
          offenders.push(`${flow.rel}: field "${field.name}" declared twice`);
        }
        seen.add(field.name);
        if (!flow.initialValueKeys.includes(field.name)) {
          offenders.push(
            `${flow.rel}: field "${field.name}" is not a key of initialValues, so it validates an answer nothing stores`
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("wires every declared answer to a control through the flow, so a required answer has somewhere to be typed", () => {
    const offenders: string[] = [];
    for (const flow of FLOWS) {
      for (const field of flow.fields) {
        const wired =
          flow.text.includes(`text("${field.name}")`) ||
          flow.text.includes(`fieldProps("${field.name}")`);
        if (!wired) {
          offenders.push(
            `${flow.rel}: field "${field.name}" (step "${field.stepId}") is never bound with flow.text() or flow.fieldProps(), so no control carries its id`
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has at least one required answer somewhere, or the required-answer machinery is untested by anything real", () => {
    expect(FLOWS.some((flow) => flow.fields.some((field) => field.required))).toBe(true);
  });

  it("never leans on the browser's `required` attribute inside a step, which does nothing for a field that is not on screen", () => {
    // This is the exact defect that shipped on the public portal: `required`
    // only fires while the control is MOUNTED, and in a stepped form it is not.
    // Scoped to the JSX a step paints, read from the AST — a file may still
    // hold an ordinary inline form elsewhere, and that form's `required` is
    // fine because its submit button sits beside it.
    const offenders: string[] = [];
    for (const flow of FLOWS) {
      for (const body of flow.renderBodies) {
        walk(body, (node) => {
          if (!ts.isJsxAttribute(node)) return;
          if (ts.isIdentifier(node.name) && node.name.text === "required") {
            offenders.push(`${flow.rel} (flow "${flow.id}") uses the browser's required attribute inside a step`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never nests a <form> inside a step, which would give the submit a second path the flow does not check", () => {
    const offenders: string[] = [];
    for (const flow of FLOWS) {
      for (const body of flow.renderBodies) {
        walk(body, (node) => {
          const tag = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node.tagName : null;
          if (tag && ts.isIdentifier(tag) && tag.text === "form") {
            offenders.push(`${flow.rel} (flow "${flow.id}") nests a <form> inside a step`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually renders the flow it builds — a flow no planner can open is the shipped-invisible defect", () => {
    const offenders = FLOW_FILES.filter(
      (file) => /useGuidedFlow\s*[<(]/.test(file.text) && !/<GuidedFlow[\s/>]/.test(file.text)
    ).map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it("gives every flow on the page a distinct id, because the id namespaces every control's DOM id", () => {
    const byId = new Map<string, string[]>();
    for (const flow of FLOWS) {
      byId.set(flow.id, [...(byId.get(flow.id) ?? []), flow.rel]);
    }
    const clashes = [...byId.entries()]
      .filter(([, files]) => new Set(files).size > 1)
      .map(([id, files]) => `${id}: ${[...new Set(files)].join(", ")}`);
    expect(clashes).toEqual([]);
  });
});

describe("one modal primitive, not several", () => {
  it("authors <dialog> only in the shared ui/ components, so nothing re-derives modality by hand", () => {
    // Two hand-rolled modals is how the focus trap in `confirm-dialog` got
    // copied slightly wrong once already. A dialog anywhere else is a second
    // implementation waiting to drift.
    const offenders = PARSED.filter(
      (file) => /<dialog[\s>]/.test(file.text) && !file.rel.startsWith("components/ui/")
    ).map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it("never opens a dialog with the `open` attribute, which is a non-modal dialog wearing a modal's clothes", () => {
    // `<dialog open>` renders outside the top layer with a live background and
    // no Escape. It looks identical until somebody tabs.
    const offenders = PARSED.filter((file) => /<dialog[^>]*\sopen[\s=>]/.test(file.text)).map(
      (file) => file.rel
    );
    expect(offenders).toEqual([]);
  });
});
