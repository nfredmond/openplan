import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Every Supabase read and write in the source, resolved structurally.
 *
 * The guards above this ask questions a regex cannot answer: which `.from()`
 * owns this `.update()`, which client is behind it, and what comes after it in
 * the chain. Real call sites look like
 *
 *     const { data, error } = await supabase
 *       .from("project_rtp_cycle_links")
 *       .update(updates)
 *       .eq("id", link.id)
 *       .select("id, project_id, …")
 *       .single();
 *
 * — prettier-split, with parentheses and string literals inside the arguments.
 * The existing guards in this repo use regex because they only ever ask "does
 * this file contain this token", which regex is fine for. These ask about
 * structure, so they use the TypeScript AST. `typescript` is already a
 * devDependency; nothing new is installed.
 *
 * `Buffer.from(x).update(y)` and `Array.from(rows)` fall out correctly: the
 * receiver is checked against the JS globals that also have a `.from`.
 */

const SRC_DIR = path.join(process.cwd(), "src");
export const API_DIR = path.join(SRC_DIR, "app", "api");

/** Globals with a `.from` that have nothing to do with Supabase. */
const NON_SUPABASE_RECEIVERS = new Set([
  "Buffer",
  "Array",
  "Object",
  "Date",
  "Set",
  "Map",
  "WeakMap",
  "WeakSet",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "String",
  "Number",
]);

export type SupabaseWriteVerb = "insert" | "upsert" | "update" | "delete";
export type WriteCommand = "INSERT" | "UPDATE" | "DELETE";
export type ClientKind = "caller-rls" | "service-role" | "unresolved";

const VERB_COMMAND: Record<SupabaseWriteVerb, WriteCommand> = {
  insert: "INSERT",
  upsert: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
};

export type SupabaseWriteSite = {
  /** Repo-relative, forward slashes on every platform. */
  file: string;
  /** Path relative to src/app/api when the file is a route, else null. */
  routeId: string | null;
  line: number;
  verb: SupabaseWriteVerb;
  command: WriteCommand;
  /** The table name when `.from()` took a string literal, else null. */
  table: string | null;
  /** Source text of the `.from()` argument, for reporting dynamic targets. */
  tableExpression: string;
  /** Source text of whatever `.from()` was called on. */
  receiver: string;
  clientKind: ClientKind;
  /** Method names chained after the verb, in order. */
  chain: string[];
  /** Whether this write can see how many rows it changed AND looks at the answer. */
  verifiesAffectedRows: boolean;
};

export type SupabaseSelectSite = {
  file: string;
  line: number;
  table: string | null;
  tableExpression: string;
  /** First argument of `.select()`, unquoted when it was a string literal. */
  projection: string | null;
  /** Source text of the projection argument, whatever its kind. */
  projectionExpression: string;
  /** True when the second argument requests a row count. */
  isCount: boolean;
  countMode: string | null;
  headOnly: boolean;
  /** True when this select is the RETURNING clause of a write. */
  followsWrite: boolean;
};

export type ShadowedBinding = { file: string; name: string; initializers: string[] };

function walkFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];

  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `src/test` is skipped so a guard's own assertion text cannot satisfy it.
      return entry === "test" ? [] : walkFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function repoRelative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function routeIdOf(file: string): string | null {
  if (!file.startsWith(API_DIR + path.sep)) return null;
  return path.relative(API_DIR, file).split(path.sep).join("/");
}

type Declaration = {
  name: string;
  /** Start of the declaration, so a use before it does not resolve to it. */
  pos: number;
  scopeStart: number;
  scopeEnd: number;
  /** Source text the name is bound to. For a destructure, the object being destructured. */
  initializer: string;
  initializerNode: ts.Node;
};

/** The nearest enclosing block, function body or file — good enough for `const`. */
function enclosingScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isCaseClause(current) || ts.isModuleBlock(current)) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

/**
 * Every `const`/`let` declaration in the file, with the scope it belongs to.
 *
 * Scope-aware rather than a flat name→text map, because ten files in this repo
 * DO bind the same client identifier twice with different initializers — a
 * route whose POST holds `const supabase = await createClient()` while its
 * DELETE holds `const { supabase } = resolved` from an access loader. A flat map
 * silently answers with whichever it saw last, which is a wrong answer about
 * which key is behind a write.
 */
function collectDeclarations(source: ts.SourceFile): {
  declarations: Declaration[];
  shadowed: ShadowedBinding[];
  aliases: Map<string, string>;
} {
  const declarations: Declaration[] = [];
  // `type ServiceClientLike = ReturnType<typeof createServiceRoleClient>` names
  // the factory one level of indirection away; following it is the difference
  // between resolving a client and allowlisting it.
  const aliases = new Map<string, string>();

  const visit = (node: ts.Node) => {
    if (ts.isTypeAliasDeclaration(node)) {
      aliases.set(node.name.text, node.type.getText(source));
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const scope = enclosingScope(node);
      const base = {
        pos: node.getStart(source),
        scopeStart: scope.getStart(source),
        scopeEnd: scope.getEnd(),
        initializer: node.initializer.getText(source),
        initializerNode: node.initializer,
      };

      if (ts.isIdentifier(node.name)) {
        declarations.push({ ...base, name: node.name.text });
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name)) declarations.push({ ...base, name: element.name.text });
        }
      }
    }

    // A parameter's TYPE is evidence when it names the factory —
    // `serviceSupabase: ReturnType<typeof createServiceRoleClient>` says exactly
    // which key is behind it. A structural type (`SupabaseClient`,
    // `Pick<SupabaseClient, "from">`) says nothing, stays unresolved, and is
    // treated as caller-RLS by the guards above.
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && (node.type || node.initializer)) {
      const signature = node.parent as ts.Node & { body?: ts.Node };
      const owner = signature.body ?? signature;
      // A default value is evidence as direct as a call site:
      // `client: ServiceClientLike = createServiceRoleClient()`.
      const evidence = [node.type?.getText(source), node.initializer?.getText(source)]
        .filter(Boolean)
        .join(" = ");
      declarations.push({
        name: node.name.text,
        pos: node.getStart(source),
        scopeStart: owner.getStart(source),
        scopeEnd: owner.getEnd(),
        initializer: evidence,
        initializerNode: node.initializer ?? node.type ?? node,
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  const byName = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    const existing = byName.get(declaration.name) ?? new Set<string>();
    existing.add(declaration.initializer);
    byName.set(declaration.name, existing);
  }

  const shadowed: ShadowedBinding[] = [];
  for (const [name, initializers] of byName) {
    if (initializers.size > 1) shadowed.push({ file: source.fileName, name, initializers: [...initializers] });
  }

  return { declarations, shadowed, aliases };
}

/** The innermost declaration of `name` whose scope contains `position`. */
function lookup(declarations: Declaration[], name: string, position: number): Declaration | null {
  const candidates = declarations.filter(
    (declaration) =>
      declaration.name === name &&
      declaration.scopeStart <= position &&
      position <= declaration.scopeEnd &&
      declaration.pos < position
  );
  if (!candidates.length) return null;

  return candidates.reduce((best, current) =>
    current.scopeStart > best.scopeStart || (current.scopeStart === best.scopeStart && current.pos > best.pos)
      ? current
      : best
  );
}

/** Direct evidence in one expression's text. Null when it says nothing either way. */
function classifyText(text: string): ClientKind | null {
  // Both a call (`createServiceRoleClient()`) and a type reference naming the
  // factory (`ReturnType<typeof createServiceRoleClient>`) are direct evidence.
  const service = /createServiceRoleClient\s*[(<]|typeof\s+createServiceRoleClient\b/.test(text);
  const caller = /(?:await\s+)?createClient\s*\(|typeof\s+createClient\b/.test(text);

  // Fails closed: the one ternary in the codebase
  // (`callbackBearerValid ? createServiceRoleClient() : await createClient()`)
  // classifies as caller-rls, because one of its branches is.
  if (caller) return "caller-rls";
  if (service) return "service-role";
  return null;
}

const MAX_RESOLUTION_HOPS = 5;

/**
 * Which key is behind this receiver expression.
 *
 * Follows three hops that actually occur here, and no more:
 *
 *   `supabase`            → its innermost declaration
 *   `const { supabase } = access`
 *                         → whatever `access` resolves to
 *   `access.supabase`     → the object, then — because every access loader in
 *                           this repo takes a client and hands the SAME client
 *                           back on its result — the client argument it was
 *                           called with.
 *
 * Anything else stays `unresolved`, and callers must treat that as caller-rls.
 * Guessing in the other direction would exempt a real write from the guard.
 */
function resolveClientKind(
  source: ts.SourceFile,
  declarations: Declaration[],
  aliases: Map<string, string>,
  expression: string,
  position: number,
  hops = 0
): ClientKind {
  if (hops > MAX_RESOLUTION_HOPS) return "unresolved";

  const direct = classifyText(expression);
  if (direct) return direct;

  const aliased = aliases.get(expression.trim());
  if (aliased) {
    const viaAlias = classifyText(aliased);
    if (viaAlias) return viaAlias;
  }

  const root = expression.split(/[.?[(]/)[0].trim();
  if (!root) return "unresolved";

  const declaration = lookup(declarations, root, position);
  if (!declaration) return "unresolved";

  const fromInitializer = classifyText(declaration.initializer);
  if (fromInitializer) return fromInitializer;

  for (const [alias, aliasText] of aliases) {
    if (new RegExp(`\\b${alias}\\b`).test(declaration.initializer)) {
      const viaAlias = classifyText(aliasText);
      if (viaAlias) return viaAlias;
    }
  }

  // `const access = await loadReportAccess(supabase, …)` — the loader hands back
  // the client it was given, so the client is one of the arguments.
  let call: ts.Node = declaration.initializerNode;
  if (ts.isAwaitExpression(call)) call = call.expression;
  if (ts.isCallExpression(call)) {
    for (const argument of call.arguments) {
      const kind = resolveClientKind(source, declarations, aliases, argument.getText(source), position, hops + 1);
      if (kind !== "unresolved") return kind;
    }
    return "unresolved";
  }

  // `const { supabase } = resolved` — keep going through the object.
  return resolveClientKind(source, declarations, aliases, declaration.initializer, position, hops + 1);
}

/** Descend a method chain to the `.from(…)` call that started it. */
function findFromCall(node: ts.Node): ts.CallExpression | null {
  let current: ts.Node | undefined = node;

  while (current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "from"
    ) {
      return current;
    }
    if (ts.isCallExpression(current)) {
      current = current.expression;
    } else if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    } else if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isNonNullExpression(current) || ts.isAsExpression(current)) {
      current = current.expression;
    } else {
      return null;
    }
  }

  return null;
}

/** The nearest enclosing function-like node, for reference counting. */
function enclosingFunction(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current) || ts.isMethodDeclaration(current)) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

/**
 * Whether the rows this write returned are actually LOOKED AT.
 *
 * `.select()` makes the affected rows observable, but observable is not
 * observed: a route that chains `.select()` and then ignores the result is in
 * exactly the same position as one that never asked. So this finds the `data`
 * binding the write's result is destructured into and requires it to be
 * referenced again inside the same function.
 *
 * `.single()` is exempt from that requirement because it is self-reporting —
 * zero rows becomes PGRST116 in `error`, which every one of these routes
 * already branches on.
 */
function resultIsInspected(write: ts.Node, source: ts.SourceFile): boolean {
  // Climb past the chain to the awaited expression and its declaration.
  let current: ts.Node = write;
  while (
    current.parent &&
    (ts.isPropertyAccessExpression(current.parent) ||
      ts.isCallExpression(current.parent) ||
      ts.isAwaitExpression(current.parent))
  ) {
    current = current.parent;
  }

  const declaration = current.parent;
  if (!declaration || !ts.isVariableDeclaration(declaration)) return false;

  const names: string[] = [];
  if (ts.isIdentifier(declaration.name)) {
    names.push(declaration.name.text);
  } else if (ts.isObjectBindingPattern(declaration.name)) {
    for (const element of declaration.name.elements) {
      const property = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : null;
      // Only the DATA half answers "how many rows"; `error` is null either way.
      if ((property ?? (ts.isIdentifier(element.name) ? element.name.text : "")) !== "data") continue;
      if (ts.isIdentifier(element.name)) names.push(element.name.text);
    }
  }
  if (!names.length) return false;

  const scope = enclosingFunction(declaration);
  const after = declaration.getEnd();
  let referenced = false;

  const visit = (node: ts.Node) => {
    if (referenced) return;
    if (ts.isIdentifier(node) && node.getStart(source) > after && names.includes(node.text)) {
      referenced = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);

  return referenced;
}

/** Method names called on the result of `node`, in order. */
function chainAfter(node: ts.CallExpression, source: ts.SourceFile): Array<{ name: string; call: ts.CallExpression }> {
  const chain: Array<{ name: string; call: ts.CallExpression }> = [];
  let current: ts.Node = node;

  for (;;) {
    const access = current.parent;
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== current) break;
    const call = access.parent;
    if (!call || !ts.isCallExpression(call) || call.expression !== access) break;

    chain.push({ name: access.name.getText(source), call });
    current = call;
  }

  return chain;
}

type ResolvedFrom = { table: string | null; tableExpression: string; receiver: string };

function resolveFrom(fromCall: ts.CallExpression, source: ts.SourceFile): ResolvedFrom | null {
  if (!ts.isPropertyAccessExpression(fromCall.expression)) return null;

  const receiver = fromCall.expression.expression.getText(source);
  const root = receiver.split(/[.[(]/)[0];
  if (NON_SUPABASE_RECEIVERS.has(root)) return null;

  const argument = fromCall.arguments[0];
  if (!argument) return null;

  const tableExpression = argument.getText(source);
  const table = ts.isStringLiteralLike(argument) ? argument.text : null;

  return { table, tableExpression, receiver };
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export type CollectOptions = { roots?: string[]; files?: string[] };

function targetFiles(options: CollectOptions): string[] {
  if (options.files) return options.files;
  const roots = options.roots ?? [SRC_DIR];
  return roots.flatMap((root) => walkFiles(root));
}

/** Every `insert` / `upsert` / `update` / `delete` reached through a `.from()`. */
export function collectSupabaseWriteSites(options: CollectOptions = {}): SupabaseWriteSite[] {
  const sites: SupabaseWriteSite[] = [];

  for (const file of targetFiles(options)) {
    const source = parse(file);
    const { declarations, aliases } = collectDeclarations(source);

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const verb = node.expression.name.getText(source) as SupabaseWriteVerb;

        if (verb in VERB_COMMAND) {
          const fromCall = findFromCall(node.expression.expression);
          const resolved = fromCall ? resolveFrom(fromCall, source) : null;

          if (resolved) {
            const chain = chainAfter(node, source);
            const chainNames = chain.map((entry) => entry.name);

            // A write can only observe how many rows it changed if it asks.
            // `.single()` raises PGRST116 on zero rows; `.maybeSingle()` returns
            // null; a count option returns the number outright. Without one of
            // them, supabase-js reports `error: null` whether the write matched
            // one row or none.
            const selectEntry = chain.find((entry) => entry.name === "select");
            const optionsText = selectEntry?.call.arguments[1]?.getText(source) ?? "";
            const observable =
              chainNames.includes("select") ||
              chainNames.includes("maybeSingle") ||
              /count:\s*["'](exact|planned|estimated)["']/.test(optionsText);
            const verifiesAffectedRows =
              chainNames.includes("single") || (observable && resultIsInspected(node, source));

            sites.push({
              file: repoRelative(file),
              routeId: routeIdOf(file),
              line: lineOf(source, node),
              verb,
              command: VERB_COMMAND[verb],
              table: resolved.table,
              tableExpression: resolved.tableExpression,
              receiver: resolved.receiver,
              clientKind: resolveClientKind(source, declarations, aliases, resolved.receiver, node.getStart(source)),
              chain: chainNames,
              verifiesAffectedRows,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return sites;
}

/** Every `.select()` reached through a `.from()`, read or RETURNING. */
export function collectSupabaseSelectSites(options: CollectOptions = {}): SupabaseSelectSite[] {
  const sites: SupabaseSelectSite[] = [];

  for (const file of targetFiles(options)) {
    const source = parse(file);
    const { declarations } = collectDeclarations(source);

    /**
     * `.select(KB_DOCUMENT_COLUMNS)` is as checkable as `.select("id, name")`
     * when the constant is a string literal in the same file — and projections
     * are very often hoisted into a constant precisely because they are long,
     * which is exactly when a column typo is easiest to miss.
     */
    const literalProjection = (argument: ts.Node): string | null => {
      if (ts.isStringLiteralLike(argument)) return argument.text;
      if (!ts.isIdentifier(argument)) return null;

      const declaration = lookup(declarations, argument.text, argument.getStart(source));
      if (!declaration) return null;

      const text = declaration.initializer.trim();
      const quoted = text.match(/^(["'`])([\s\S]*)\1$/);
      // A template literal with an interpolation is not a fixed projection.
      if (!quoted || quoted[2].includes("${")) return null;
      return quoted[2];
    };

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText(source) === "select"
      ) {
        const base = node.expression.expression;
        const fromCall = findFromCall(base);
        const resolved = fromCall ? resolveFrom(fromCall, source) : null;

        if (resolved) {
          const projectionArg = node.arguments[0];
          const optionsText = node.arguments[1]?.getText(source) ?? "";
          const countMatch = optionsText.match(/count:\s*["'](exact|planned|estimated)["']/);

          // Anything between `.from()` and this `.select()` that is a write verb
          // makes this a RETURNING clause rather than a read.
          let followsWrite = false;
          let cursor: ts.Node | undefined = base;
          while (cursor && cursor !== fromCall) {
            if (ts.isCallExpression(cursor) && ts.isPropertyAccessExpression(cursor.expression)) {
              if (cursor.expression.name.getText(source) in VERB_COMMAND) followsWrite = true;
            }
            cursor = ts.isCallExpression(cursor)
              ? cursor.expression
              : ts.isPropertyAccessExpression(cursor)
                ? cursor.expression
                : undefined;
          }

          sites.push({
            file: repoRelative(file),
            line: lineOf(source, node),
            table: resolved.table,
            tableExpression: resolved.tableExpression,
            projection: projectionArg ? literalProjection(projectionArg) : null,
            projectionExpression: projectionArg?.getText(source) ?? "",
            isCount: Boolean(countMatch),
            countMode: countMatch?.[1] ?? null,
            headOnly: /head:\s*true/.test(optionsText),
            followsWrite,
          });
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return sites;
}

export type HelperCallSite = {
  file: string;
  line: number;
  fn: string;
  /** Source text of the argument taken to be the client. */
  argumentText: string;
  clientKind: ClientKind;
};

/** Property names an options object uses for its Supabase client. */
const CLIENT_PROPERTY_NAMES = new Set(["supabase", "client", "service", "serviceSupabase", "db"]);

/**
 * Where the named helpers are called, and which client each caller hands them.
 *
 * Library helpers take their client as a parameter, and the declared types say
 * nothing useful — every one of them is `SupabaseClient`,
 * `Pick<SupabaseClient, "from">` or an alias of it, which describes the SHAPE
 * and not the KEY. So the only honest way to know whether such a helper writes
 * with service-role privileges is to look at every place it is called. That is
 * what turns the write-coverage allowlist from an assertion into a proof: if
 * someone later passes the caller's client to one of these, the entry stops
 * being true and the guard says so.
 */
export function collectHelperCallSites(functionNames: string[], options: CollectOptions = {}): HelperCallSite[] {
  const wanted = new Set(functionNames);
  const sites: HelperCallSite[] = [];

  for (const file of targetFiles(options)) {
    const source = parse(file);
    const { declarations, aliases } = collectDeclarations(source);

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : null;

        if (callee && wanted.has(callee)) {
          const candidates: string[] = [];
          for (const argument of node.arguments) {
            if (ts.isObjectLiteralExpression(argument)) {
              for (const property of argument.properties) {
                const name = property.name && ts.isIdentifier(property.name) ? property.name.text : null;
                if (!name || !CLIENT_PROPERTY_NAMES.has(name)) continue;
                candidates.push(
                  ts.isPropertyAssignment(property) ? property.initializer.getText(source) : name
                );
              }
            } else {
              candidates.push(argument.getText(source));
            }
          }

          let chosen = candidates[0] ?? "";
          let kind: ClientKind = "unresolved";
          for (const candidate of candidates) {
            const resolved = resolveClientKind(source, declarations, aliases, candidate, node.getStart(source));
            if (resolved !== "unresolved") {
              chosen = candidate;
              kind = resolved;
              break;
            }
          }

          sites.push({
            file: repoRelative(file),
            line: lineOf(source, node),
            fn: callee,
            argumentText: chosen,
            clientKind: kind,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return sites;
}

/** Identifiers bound more than once, with different initializers, in one file. */
export function collectShadowedBindings(options: CollectOptions = {}): ShadowedBinding[] {
  return targetFiles(options).flatMap((file) => {
    const source = parse(file);
    return collectDeclarations(source).shadowed.map((entry) => ({ ...entry, file: repoRelative(file) }));
  });
}

/** Parse a snippet rather than a file — for the guards' own positive/negative checks. */
export function parseWriteSitesFromSource(code: string): SupabaseWriteSite[] {
  const file = path.join(SRC_DIR, "__fixture__.ts");
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { declarations, aliases } = collectDeclarations(source);
  const sites: SupabaseWriteSite[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const verb = node.expression.name.getText(source) as SupabaseWriteVerb;
      if (verb in VERB_COMMAND) {
        const fromCall = findFromCall(node.expression.expression);
        const resolved = fromCall ? resolveFrom(fromCall, source) : null;
        if (resolved) {
          const chain = chainAfter(node, source).map((entry) => entry.name);
          const selectEntry = chainAfter(node, source).find((entry) => entry.name === "select");
          const optionsText = selectEntry?.call.arguments[1]?.getText(source) ?? "";
          sites.push({
            file: "__fixture__.ts",
            routeId: null,
            line: lineOf(source, node),
            verb,
            command: VERB_COMMAND[verb],
            table: resolved.table,
            tableExpression: resolved.tableExpression,
            receiver: resolved.receiver,
            clientKind: resolveClientKind(source, declarations, aliases, resolved.receiver, node.getStart(source)),
            chain,
            verifiesAffectedRows:
              chain.includes("single") ||
              ((chain.includes("select") ||
                chain.includes("maybeSingle") ||
                /count:\s*["'](exact|planned|estimated)["']/.test(optionsText)) &&
                resultIsInspected(node, source)),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return sites;
}
