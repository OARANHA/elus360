/**
 * Evidence-only AST diagnostics for official upstream review.
 * Neither this module nor its fields grant safe_to_prepare. Its results are
 * intentionally conservative: a stable declaration shape does not prove
 * stable inferred types, runtime behavior, RLS or authorization.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require=createRequire(import.meta.url);
let ts;
try {ts=require("typescript");} catch {ts=null;}
const SOURCE=/\.(?:[cm]?[jt]s|[jt]sx)$/;
const MAX=524288;
const hash=text=>createHash("sha256").update(text).digest("hex").slice(0,16);
function parse(path,content){
  if(!ts||typeof content!=="string"||content.length>MAX||content.includes("\0"))
    return null;
  const kind=/\.tsx$/.test(path)?ts.ScriptKind.TSX:
    /\.jsx$/.test(path)?ts.ScriptKind.JSX:/\.[mc]?js$/.test(path)?ts.ScriptKind.JS:ts.ScriptKind.TS;
  const file=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,kind);
  if(file.parseDiagnostics.length) return null;
  return file;
}
function snapshot(file){
  const printer=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed});
  const emit=node=>printer.printNode(ts.EmitHint.Unspecified,node,file);
  const isExport=statement=>ts.isExportDeclaration(statement)||ts.isExportAssignment(statement)||
    statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword||
      m.kind===ts.SyntaxKind.DefaultKeyword);
  const signatures=[],ambiguous=[],exportedText=[];
  const eager=[],deferred=[],uncertain=[];
  for(const statement of file.statements){
    if(isExport(statement)){
      exportedText.push(emit(statement));
      if(ts.isFunctionDeclaration(statement)) {
        const explicit=!!statement.type && statement.parameters.every(p=>!!p.type);
        signatures.push({
          kind:"function",
          name:statement.name?.text??"<default>",
          modifiers:(statement.modifiers??[]).map(m=>m.kind),
          typeParameters:(statement.typeParameters??[]).map(emit),
          parameters:statement.parameters.map(emit),
          returnType:statement.type?emit(statement.type):null
        });
        if(!explicit) ambiguous.push("inferred_function_signature");
      }else if(ts.isVariableStatement(statement)){
        signatures.push({
          kind:"variable",
          constant:!!(statement.declarationList.flags & ts.NodeFlags.Const),
          declarations:statement.declarationList.declarations.map(d=>({
            name:emit(d.name),type:d.type?emit(d.type):null
          }))
        });
        if(statement.declarationList.declarations.some(d=>!d.type))
          ambiguous.push("inferred_variable_signature");
      }else if(ts.isInterfaceDeclaration(statement)||ts.isTypeAliasDeclaration(statement)||
        ts.isEnumDeclaration(statement)||ts.isExportDeclaration(statement)){
        signatures.push({kind:ts.SyntaxKind[statement.kind],shape:emit(statement)});
      }else {
        // Classes, export assignments, ambient declarations and unusual syntax
        // may expose complex or inferred contracts. Never call them unchanged.
        signatures.push({kind:ts.SyntaxKind[statement.kind],unmodeled:true});
        ambiguous.push("unmodeled_export_declaration");
      }
    }
    if(ts.isVariableStatement(statement)){
      let hasEager=false,hasDeferred=false;
      const visit=node=>{
        if(ts.isFunctionLike(node)){
          const visitDeferred=child=>{
            if(ts.isCallExpression(child)||ts.isNewExpression(child)||ts.isAwaitExpression(child))
              hasDeferred=true;
            ts.forEachChild(child,visitDeferred);
          };
          ts.forEachChild(node,visitDeferred);
          return;
        }
        if(ts.isCallExpression(node)||ts.isNewExpression(node)||ts.isAwaitExpression(node))
          hasEager=true;
        ts.forEachChild(node,visit);
      };
      for(const decl of statement.declarationList.declarations)
        if(decl.initializer) visit(decl.initializer);
      if(hasEager) eager.push(emit(statement));
      if(hasDeferred) deferred.push(emit(statement));
    }else if(ts.isExpressionStatement(statement)||
      ts.isIfStatement(statement)||ts.isTryStatement(statement)||
      ts.isForStatement(statement)||ts.isForOfStatement(statement)||
      ts.isWhileStatement(statement)||ts.isDoStatement(statement)){
      eager.push(emit(statement));
    }else if(ts.isClassDeclaration(statement)||
      ts.isExportDeclaration(statement)||ts.isImportDeclaration(statement)){
      // Imported modules and class static initializers can cause effects.
      // We do not claim these are side-effect free.
      uncertain.push(ts.SyntaxKind[statement.kind]);
    }
  }
  return {signatures,ambiguous,exportedText,
    eager:eager.map(hash),deferred:deferred.map(hash),
    uncertain:[...new Set(uncertain)].sort(),
    normalizedHash:hash(printer.printFile(file))};
}
export function diagnoseAstPrecision(path,before,after){
  const unavailable={executed:false,reason:"non_source_or_uninspectable",
    normalized_syntax_equal:null,export_relation:"unresolved",
    initialization_relation:"unresolved"};
  if(!SOURCE.test(path)) return unavailable;
  const oldFile=parse(path,before),nextFile=parse(path,after);
  if(!oldFile||!nextFile) return unavailable;
  const old=snapshot(oldFile),next=snapshot(nextFile);
  const sameShape=JSON.stringify(old.signatures)===JSON.stringify(next.signatures);
  const sameExports=JSON.stringify(old.exportedText)===JSON.stringify(next.exportedText);
  const ambiguous=[...new Set([...old.ambiguous,...next.ambiguous])];
  const sameEager=JSON.stringify(old.eager)===JSON.stringify(next.eager);
  const sameDeferred=JSON.stringify(old.deferred)===JSON.stringify(next.deferred);
  const sameUncertain=JSON.stringify(old.uncertain)===JSON.stringify(next.uncertain);
  const relation=!sameShape?"export_declaration_shape_changed":
    ambiguous.length?"export_shape_inferred_or_unmodeled":
    !sameExports?"declared_shape_equal_export_body_or_initializer_changed":
    "export_declarations_unchanged_internal_behavior_unverified";
  const effects=!sameEager?"eager_effect_expression_changed":
    !sameDeferred?"deferred_function_expression_changed":
    !sameUncertain?"uncertain_import_or_class_change":
    "no_detected_effect_expression_change";
  return {
    executed:true,reason:null,
    normalized_syntax_equal:old.normalizedHash===next.normalizedHash,
    export_relation:relation,
    initialization_relation:effects,
    eager_effects_before:old.eager.length,eager_effects_after:next.eager.length,
    deferred_effects_before:old.deferred.length,deferred_effects_after:next.deferred.length,
    uncertain_effect_syntax:[...new Set([...old.uncertain,...next.uncertain])].sort(),
    ambiguous_export_reasons:ambiguous,
    evidence_only:true
  };
}