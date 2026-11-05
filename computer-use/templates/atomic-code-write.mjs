import{writeFileSync,renameSync,existsSync,unlinkSync,statSync}from'node:fs';import{randomUUID}from'node:crypto';
export function atomicCodeWrite(path,data,mode){const tmp=path+'.pi-cu-'+randomUUID();try{writeFileSync(tmp,data,{mode:mode??(existsSync(path)?statSync(path).mode&0o777:0o600),flag:'wx'});renameSync(tmp,path);}finally{if(existsSync(tmp))unlinkSync(tmp)}}
