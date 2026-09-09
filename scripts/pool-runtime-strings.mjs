import { parseAst } from "rolldown/parseAst";
import MagicString from "magic-string";

/**
 * Share repeated string values and public property names in the single-file MV3 worker.
 * This keeps names/JSON protocols unchanged: x.longProperty becomes x[constantString].
 * No eval, generated network code, runtime decoder, property renaming, or extra worker chunks.
 * Run after normal minification so punctuation ranges are unambiguous.
 */
export async function poolRuntimeStrings(code) {
  const ast = parseAst(code), candidates = new Map();
  const identifiers = new Set(), injectedNames = new Set(), injectedFunctions = new Set();
  function scan(node, parent) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier") identifiers.add(node.name);
    if (node.type === "Property" && (node.key.name === "func" || node.key.value === "func")) {
      if (node.value.type === "Identifier") injectedNames.add(node.value.name);
      else if (/Function/.test(node.value.type)) injectedFunctions.add(node.value);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach((item) => scan(item,node));
      else if (child?.type) scan(child,node);
    }
  }
  scan(ast,null);
  function add(value, node, kind) {
    if (value.length < 8 || value === "__proto__") return;
    const entries = candidates.get(value) || [];
    entries.push({ start: node.start, end: node.end, kind }); candidates.set(value, entries);
  }
  function visit(node, parent, key) {
    if (!node || typeof node !== "object") return;
    // chrome.scripting serializes func without its closure. Keep its entire body unchanged.
    if (injectedFunctions.has(node) || (/Function/.test(node.type) &&
        (injectedNames.has(node.id?.name) || (parent?.type === "VariableDeclarator" && injectedNames.has(parent.id?.name))))) return;
    if (node.type === "Literal" && typeof node.value === "string" &&
        !(key === "key" && !parent.computed) && parent.type !== "ExpressionStatement" && key !== "source") add(node.value,node,"value");
    if (node.type === "Identifier" && parent.type === "MemberExpression" && key === "property" &&
        !parent.computed && !parent.optional && code[node.start - 1] === ".") add(node.name,{start:node.start-1,end:node.end},"property");
    if (node.type === "Identifier" && parent.type === "Property" && key === "key" &&
        !parent.computed && !parent.shorthand && parent.kind === "init") add(node.name,node,"property");
    for (const [childKey,value] of Object.entries(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child,node,childKey);
      else if (value?.type) visit(value,node,childKey);
    }
  }
  visit(ast,null,null);
  const chosen=[...candidates].filter(([value,nodes]) => nodes.length > 2 && (Buffer.byteLength(JSON.stringify(value))-5)*(nodes.length-1)>30);
  if (!chosen.length) return { code, sharedStrings:0 };
  const edited=new MagicString(code), declarations=[];
  let counter=0;
  for (const [value,nodes] of chosen) {
    let name;
    do { name=`$${(counter++).toString(36)}`; } while(identifiers.has(name));
    identifiers.add(name); declarations.push(`${name}=${JSON.stringify(value)}`);
    for(const node of nodes) edited.overwrite(node.start,node.end,node.kind === "value" ? `(${name})` : `[${name}]`);
  }
  edited.prepend(`const ${declarations.join(",")};`);
  // Deliberately no second optimizer: serialized injection bodies remain byte-for-byte intact.
  const result=edited.toString();
  return Buffer.byteLength(result) < Buffer.byteLength(code) ? {code:result,sharedStrings:chosen.length} : {code,sharedStrings:0};
}
