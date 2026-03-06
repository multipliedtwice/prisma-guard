#!/usr/bin/env node

// src/generator/index.ts
import pkg from "@prisma/generator-helper";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// src/generator/emit-scope-map.ts
function isScopeRoot(documentation) {
  if (!documentation)
    return false;
  const tokens = documentation.split(/[\s\n\r]+/);
  return tokens.some((t) => t === "@scope-root");
}
function emitScopeMap(dmmf, onAmbiguousScope) {
  const rootModels = /* @__PURE__ */ new Set();
  for (const model of dmmf.datamodel.models) {
    if (isScopeRoot(model.documentation)) {
      rootModels.add(model.name);
    }
  }
  const scopeMap = {};
  for (const model of dmmf.datamodel.models) {
    if (rootModels.has(model.name))
      continue;
    const entries = [];
    for (const field of model.fields) {
      if (!field.relationFromFields || field.relationFromFields.length === 0)
        continue;
      if (!rootModels.has(field.type))
        continue;
      for (const fk of field.relationFromFields) {
        entries.push({ fk, root: field.type, relationName: field.name });
      }
    }
    if (entries.length > 0) {
      scopeMap[model.name] = entries;
    }
  }
  const excludedModels = /* @__PURE__ */ new Set();
  const ambiguityMessages = [];
  for (const [modelName, entries] of Object.entries(scopeMap)) {
    const rootCounts = {};
    for (const entry of entries) {
      if (!rootCounts[entry.root])
        rootCounts[entry.root] = [];
      rootCounts[entry.root].push(entry.fk);
    }
    for (const [root, fks] of Object.entries(rootCounts)) {
      if (fks.length > 1) {
        ambiguityMessages.push(
          `Model "${modelName}" has multiple FKs to scope root "${root}" (${fks.join(", ")}). Excluding from scope map.`
        );
        excludedModels.add(modelName);
      }
    }
  }
  if (ambiguityMessages.length > 0) {
    if (onAmbiguousScope === "error") {
      throw new Error(
        `prisma-guard: Ambiguous scope detected. Resolve these or set onAmbiguousScope to "warn" or "ignore":
${ambiguityMessages.map((m) => `  - ${m}`).join("\n")}`
      );
    }
    if (onAmbiguousScope === "warn") {
      for (const msg of ambiguityMessages) {
        console.warn(`prisma-guard: ${msg}`);
      }
    }
  }
  for (const name of excludedModels) {
    delete scopeMap[name];
  }
  const roots = Array.from(rootModels).sort();
  const mapEntries = Object.entries(scopeMap).map(([model, entries]) => {
    const entriesStr = entries.map((e) => `{ fk: ${JSON.stringify(e.fk)}, root: ${JSON.stringify(e.root)}, relationName: ${JSON.stringify(e.relationName)} }`).join(", ");
    return `  ${model}: [${entriesStr}],`;
  }).join("\n");
  const scopeRootType = roots.length > 0 ? roots.map((r) => `'${r}'`).join(" | ") : "never";
  const source = `export const SCOPE_MAP = {
${mapEntries}
} as const

export type ScopeRoot = ${scopeRootType}
`;
  return { source, roots };
}

// src/generator/validate-directive.ts
var ALLOWED_ZOD_METHODS = /* @__PURE__ */ new Set([
  "min",
  "max",
  "length",
  "email",
  "url",
  "uuid",
  "cuid",
  "cuid2",
  "ulid",
  "trim",
  "toLowerCase",
  "toUpperCase",
  "startsWith",
  "endsWith",
  "includes",
  "datetime",
  "ip",
  "cidr",
  "date",
  "time",
  "duration",
  "base64",
  "nanoid",
  "emoji",
  "int",
  "positive",
  "nonnegative",
  "negative",
  "nonpositive",
  "finite",
  "safe",
  "multipleOf",
  "step",
  "gt",
  "gte",
  "lt",
  "lte",
  "nonempty"
]);
var MAX_DIRECTIVE_LENGTH = 1024;
var MAX_CHAIN_DEPTH = 20;
function validateDirective(raw) {
  if (raw.length > MAX_DIRECTIVE_LENGTH) {
    return { valid: false, reason: "Directive exceeds maximum length" };
  }
  const input = raw.trim();
  if (input.length === 0) {
    return { valid: false, reason: "Empty directive" };
  }
  if (input[0] !== ".") {
    return { valid: false, reason: 'Directive must start with "."' };
  }
  let pos = 0;
  let chainCount = 0;
  function peek() {
    return input[pos] ?? "";
  }
  function advance() {
    return input[pos++] ?? "";
  }
  function skipWhitespace() {
    while (pos < input.length && (input[pos] === " " || input[pos] === "	")) {
      pos++;
    }
  }
  function parseString() {
    const quote = peek();
    if (quote !== '"' && quote !== "'")
      return null;
    advance();
    while (pos < input.length) {
      const ch = input[pos];
      if (ch === "\\") {
        const next = input[pos + 1];
        if (next === "'" || next === '"') {
          pos += 2;
          continue;
        }
        return { valid: false, reason: `Invalid escape sequence "\\${next ?? ""}" in string` };
      }
      if (ch === quote) {
        advance();
        return null;
      }
      if (ch.charCodeAt(0) < 32) {
        return { valid: false, reason: "Control character in string" };
      }
      advance();
    }
    return { valid: false, reason: "Unterminated string" };
  }
  function parseNumber() {
    const start = pos;
    if (peek() === "-")
      advance();
    if (pos >= input.length || !/[0-9]/.test(peek())) {
      pos = start;
      return null;
    }
    while (pos < input.length && /[0-9]/.test(peek()))
      advance();
    if (peek() === ".") {
      advance();
      if (!/[0-9]/.test(peek())) {
        return { valid: false, reason: "Invalid number: expected digit after decimal point" };
      }
      while (pos < input.length && /[0-9]/.test(peek()))
        advance();
    }
    if (peek() === "e" || peek() === "E") {
      advance();
      if (peek() === "-")
        advance();
      if (peek() === "+") {
        return { valid: false, reason: 'Invalid number: "+" not allowed in exponent' };
      }
      if (!/[0-9]/.test(peek())) {
        return { valid: false, reason: "Invalid number: expected digit in exponent" };
      }
      while (pos < input.length && /[0-9]/.test(peek()))
        advance();
    }
    return null;
  }
  function parseArg() {
    skipWhitespace();
    const ch = peek();
    if (ch === "{" || ch === "}") {
      return { valid: false, reason: "Object literals not allowed in directive args" };
    }
    if (ch === "`") {
      return { valid: false, reason: "Template literals not allowed in directive args" };
    }
    if (ch !== "" && ch.charCodeAt(0) < 32) {
      return { valid: false, reason: "Control character not allowed outside strings" };
    }
    if (ch === '"' || ch === "'") {
      return parseString();
    }
    if (ch === "[") {
      advance();
      skipWhitespace();
      if (peek() === "]") {
        advance();
        return null;
      }
      const firstErr = parseArg();
      if (firstErr)
        return firstErr;
      skipWhitespace();
      while (peek() === ",") {
        advance();
        const elemErr = parseArg();
        if (elemErr)
          return elemErr;
        skipWhitespace();
      }
      if (peek() !== "]") {
        return { valid: false, reason: 'Expected "]" to close array' };
      }
      advance();
      return null;
    }
    if (ch === "-" || /[0-9]/.test(ch)) {
      return parseNumber();
    }
    if (input.startsWith("true", pos)) {
      const after = input[pos + 4];
      if (!after || !/[a-zA-Z0-9_]/.test(after)) {
        pos += 4;
        return null;
      }
    }
    if (input.startsWith("false", pos)) {
      const after = input[pos + 5];
      if (!after || !/[a-zA-Z0-9_]/.test(after)) {
        pos += 5;
        return null;
      }
    }
    if (input.startsWith("null", pos)) {
      const after = input[pos + 4];
      if (!after || !/[a-zA-Z0-9_]/.test(after)) {
        pos += 4;
        return null;
      }
    }
    if (input.startsWith("NaN", pos)) {
      return { valid: false, reason: "NaN not allowed" };
    }
    if (input.startsWith("Infinity", pos)) {
      return { valid: false, reason: "Infinity not allowed" };
    }
    if (ch === "+") {
      return { valid: false, reason: '"+" prefix not allowed on numbers' };
    }
    if (/[a-zA-Z_]/.test(ch)) {
      return { valid: false, reason: "Identifiers not allowed as argument values" };
    }
    return { valid: false, reason: `Unexpected character "${ch}"` };
  }
  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length)
      break;
    if (peek() !== ".") {
      return { valid: false, reason: `Expected "." at position ${pos}, got "${peek()}"` };
    }
    advance();
    if (!/[a-zA-Z_]/.test(peek())) {
      return { valid: false, reason: `Expected method name after "." at position ${pos}` };
    }
    let ident = "";
    while (pos < input.length && /[a-zA-Z0-9_]/.test(peek())) {
      ident += advance();
    }
    if (!ALLOWED_ZOD_METHODS.has(ident)) {
      return { valid: false, reason: `Unknown zod method: ${ident}` };
    }
    skipWhitespace();
    if (peek() !== "(") {
      return { valid: false, reason: `Expected "(" after method "${ident}"` };
    }
    advance();
    skipWhitespace();
    if (peek() !== ")") {
      const argErr = parseArg();
      if (argErr)
        return argErr;
      skipWhitespace();
      while (peek() === ",") {
        advance();
        const nextArgErr = parseArg();
        if (nextArgErr)
          return nextArgErr;
        skipWhitespace();
      }
    }
    if (peek() !== ")") {
      return { valid: false, reason: `Expected ")" to close method "${ident}"` };
    }
    advance();
    chainCount++;
    if (chainCount > MAX_CHAIN_DEPTH) {
      return { valid: false, reason: "Directive exceeds maximum chain depth" };
    }
  }
  if (chainCount === 0) {
    return { valid: false, reason: "No method calls found" };
  }
  return { valid: true };
}

// src/generator/emit-zod-chains.ts
function findZodInDoc(documentation) {
  return documentation.split("\n").filter((line) => {
    const trimmed = line.trim();
    return /(?:^|\s)@zod(?:\s|$|\.)/.test(trimmed);
  });
}
function emitZodChains(dmmf, onInvalidZod) {
  const modelChains = {};
  for (const model of dmmf.datamodel.models) {
    for (const field of model.fields) {
      if (!field.documentation)
        continue;
      const zodLines = findZodInDoc(field.documentation);
      if (zodLines.length === 0)
        continue;
      if (zodLines.length > 1) {
        const msg = `prisma-guard: Multiple @zod directives on ${model.name}.${field.name}. Only one @zod per field allowed.`;
        if (onInvalidZod === "error") {
          throw new Error(msg);
        }
        console.warn(msg);
        continue;
      }
      const line = zodLines[0];
      const idx = line.indexOf("@zod");
      const chainStr = line.slice(idx + 4).trim();
      if (chainStr.length === 0) {
        const msg = `prisma-guard: Empty @zod directive on ${model.name}.${field.name}. Add a method chain (e.g. @zod .min(1)) or remove the directive.`;
        if (onInvalidZod === "error") {
          throw new Error(msg);
        }
        console.warn(msg);
        continue;
      }
      const result = validateDirective(chainStr);
      if (!result.valid) {
        const msg = `prisma-guard: Invalid @zod directive on ${model.name}.${field.name}: ${result.reason}`;
        if (onInvalidZod === "error") {
          throw new Error(msg);
        }
        console.warn(msg);
        continue;
      }
      if (!modelChains[model.name])
        modelChains[model.name] = {};
      modelChains[model.name][field.name] = chainStr;
    }
  }
  const hasChains = Object.keys(modelChains).length > 0;
  if (!hasChains) {
    return { source: "export const ZOD_CHAINS = {}\n", hasChains: false };
  }
  const entries = Object.entries(modelChains).map(([model, fields]) => {
    const fieldEntries = Object.entries(fields).map(([field, chain]) => `    ${JSON.stringify(field)}: (base: any) => base${chain},`).join("\n");
    return `  ${JSON.stringify(model)}: {
${fieldEntries}
  },`;
  }).join("\n");
  return {
    source: `export const ZOD_CHAINS = {
${entries}
}
`,
    hasChains: true
  };
}

// src/generator/emit-type-map.ts
var SKIP_FIELD_KINDS = /* @__PURE__ */ new Set(["unsupported"]);
function emitTypeMap(dmmf) {
  const enumNames = new Set(dmmf.datamodel.enums.map((e) => e.name));
  for (const e of dmmf.datamodel.enums) {
    if (e.values.length === 0) {
      throw new Error(`prisma-guard: Enum "${e.name}" has zero values.`);
    }
  }
  const modelEntries = dmmf.datamodel.models.map((model) => {
    const fieldEntries = model.fields.filter((field) => !SKIP_FIELD_KINDS.has(field.kind)).map((field) => {
      const isRelation = field.kind === "object" || field.relationName != null;
      const isEnum = enumNames.has(field.type);
      const meta = [
        `type: ${JSON.stringify(field.type)}`,
        `isList: ${field.isList}`,
        `isRequired: ${field.isRequired}`,
        `isId: ${field.isId}`,
        `isRelation: ${isRelation}`,
        `hasDefault: ${field.hasDefaultValue}`,
        `isUpdatedAt: ${field.isUpdatedAt}`
      ];
      if (isEnum)
        meta.push(`isEnum: true`);
      return `    ${JSON.stringify(field.name)}: { ${meta.join(", ")} },`;
    }).join("\n");
    return `  ${JSON.stringify(model.name)}: {
${fieldEntries}
  },`;
  }).join("\n");
  const enumEntries = dmmf.datamodel.enums.map((e) => {
    const values = e.values.map((v) => JSON.stringify(v.name)).join(", ");
    return `  ${JSON.stringify(e.name)}: [${values}],`;
  }).join("\n");
  const typeMapSource = `export const TYPE_MAP = {
${modelEntries}
} as const
`;
  const enumMapSource = `export const ENUM_MAP = {
${enumEntries}
} as const
`;
  const typesSource = [
    `export type ModelName = keyof typeof TYPE_MAP`,
    `export type FieldName<M extends ModelName> = keyof (typeof TYPE_MAP)[M]`
  ].join("\n");
  return `${typeMapSource}
${enumMapSource}
${typesSource}
`;
}

// src/generator/index.ts
var { generatorHandler } = pkg;
var VALID_ON_INVALID_ZOD = /* @__PURE__ */ new Set(["error", "warn"]);
var VALID_ON_AMBIGUOUS_SCOPE = /* @__PURE__ */ new Set(["error", "warn", "ignore"]);
var VALID_ON_MISSING_SCOPE_CONTEXT = /* @__PURE__ */ new Set(["error", "warn", "ignore"]);
var VALID_FIND_UNIQUE_MODE = /* @__PURE__ */ new Set(["verify", "reject"]);
function validateConfigEnum(name, value, allowed) {
  if (!allowed.has(value)) {
    throw new Error(
      `prisma-guard: Invalid generator config "${name}": "${value}". Allowed values: ${[...allowed].join(", ")}`
    );
  }
}
generatorHandler({
  onManifest() {
    return {
      prettyName: "Prisma Guard",
      defaultOutput: "generated/guard"
    };
  },
  async onGenerate(options) {
    const output = options.generator.output?.value;
    if (!output)
      throw new Error("prisma-guard: No output directory specified");
    const config = options.generator.config ?? {};
    const onInvalidZod = config.onInvalidZod ?? "error";
    const onAmbiguousScope = config.onAmbiguousScope ?? "error";
    const onMissingScopeContext = config.onMissingScopeContext ?? "error";
    const findUniqueMode = config.findUniqueMode ?? "verify";
    validateConfigEnum("onInvalidZod", onInvalidZod, VALID_ON_INVALID_ZOD);
    validateConfigEnum("onAmbiguousScope", onAmbiguousScope, VALID_ON_AMBIGUOUS_SCOPE);
    validateConfigEnum("onMissingScopeContext", onMissingScopeContext, VALID_ON_MISSING_SCOPE_CONTEXT);
    validateConfigEnum("findUniqueMode", findUniqueMode, VALID_FIND_UNIQUE_MODE);
    const dmmf = options.dmmf;
    const parts = [];
    parts.push(
      `export const GUARD_CONFIG = {
  onMissingScopeContext: ${JSON.stringify(onMissingScopeContext)},
  findUniqueMode: ${JSON.stringify(findUniqueMode)},
} as const
`
    );
    const { source: scopeSource } = emitScopeMap(dmmf, onAmbiguousScope);
    parts.push(scopeSource);
    const typeMapSource = emitTypeMap(dmmf);
    parts.push(typeMapSource);
    const { source: zodChainsSource } = emitZodChains(dmmf, onInvalidZod);
    parts.push(zodChainsSource);
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "index.ts"), parts.join("\n"), "utf-8");
  }
});
//# sourceMappingURL=index.js.map