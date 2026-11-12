/** Delta-first: proveniência por blob e modo Git. Preparação não autoriza merge. */
const OWN=/^(?:lib\/elus360\/|components\/elus360\/|docs\/elus360\/|scripts\/elus-|tests\/(?:unit\/elus360-|operational\/elus-))/;
const DB=/^(?:supabase\/|scripts\/.*(?:migration|sql|upgrade|baseline))/i;
const OPS=/^(?:\.github\/|Dockerfile|compose|hostgator-setup-kit\/|package\.json$|pnpm-lock\.yaml$|proxy\.ts$|\.env|CLAUDE\.md$|AGENTS\.md$|tsconfig|next\.config|vitest\.config)/;
function valid(path){
  return typeof path==="string"&&path.length>0&&path.length<4096&&
    !path.startsWith("/")&&!path.includes("\\")&&!/[\x00-\x1f\x7f]/.test(path)&&
    path.split("/").every(s=>s&&s!=="."&&s!=="..");
}
export function deltaDecision({path,baseOid,targetOid,forkOid,baseMode,targetMode,forkMode}){
  if(!valid(path))return "review_invalid_path";
  if(targetOid===forkOid&&targetMode===forkMode)return "already_integrated";
  if(baseOid!==forkOid||baseMode!==forkMode)return "review_fork_overlap";
  if(targetOid===null)return "review_upstream_deletion";
  if(targetMode!=="100644")return "review_git_object_mode";
  if(OWN.test(path))return "review_elus_namespace";
  if(DB.test(path))return "review_database_schema";
  if(OPS.test(path))return "review_distribution_contract";
  return "stage_direct_candidate";
}
/** Dependências de módulos upstream com consumidores personalizados no fork. */
export function localCustomizationConsumers(paths,changedByFork,graph){
  const changed=new Set(changedByFork),result=new Map();
  for(const path of paths){
    const seen=new Set([path]),queue=[path],hits=new Set();
    for(let i=0;i<queue.length;i++)for(const consumer of graph.reverse?.get(queue[i])??[]){
      if(changed.has(consumer))hits.add(consumer);
      if(!seen.has(consumer)){seen.add(consumer);queue.push(consumer);}
    }
    if(hits.size)result.set(path,[...hits].sort());
  }
  return result;
}
