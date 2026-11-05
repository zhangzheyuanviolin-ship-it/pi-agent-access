export const OMNI_MODELS = {minicpm:'MiniCPM-o-4.5-F16',qwen:'Qwen3-Omni-30B-A3B-Instruct-BF16'} as const;
export function omniKind(model?:{provider:string;id?:string;modelId?:string}|null) {
 if(model?.provider!=='mac-local-unified')return;
 return (Object.keys(OMNI_MODELS) as (keyof typeof OMNI_MODELS)[]).find(k=>OMNI_MODELS[k]===(model.id??model.modelId));
}
