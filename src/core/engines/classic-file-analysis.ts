import { confirmWithAST, type ASTRule } from "../ast-confirm.js";

export function astConfirmedCount(files: string[], contents: Map<string, string>, rule: ASTRule): number {
  let total = 0;
  for (const file of files) {
    const content = contents.get(file) ?? "";
    const astCount = confirmWithAST(content, rule);
    if (astCount >= 0) total += astCount;
  }
  return total;
}
