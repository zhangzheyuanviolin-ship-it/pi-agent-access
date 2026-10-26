import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ToolSetupDialog} from '../components/ToolSetupDialog';
import {PermissionsConfig} from '../components/PermissionsConfig';
import {MemoryConfig} from '../components/MemoryConfig';
const load=async()=>({tools:[],systemPrompt:'',sessionId:'fixture'});
function Fixture(){const [open,setOpen]=useState(false);const [memory,setMemory]=useState(false);const [permissions,setPermissions]=useState(false);return <><button onClick={()=>setOpen(true)}>打开上下文与能力</button><button onClick={()=>setMemory(true)}>打开记忆</button><button onClick={()=>setPermissions(v=>!v)}>打开权限</button>{permissions&&<PermissionsConfig/>}{open&&<ToolSetupDialog current="configured" load={load} onPreset={async()=>{}} onClose={()=>setOpen(false)}/>} {memory&&<MemoryConfig cwd="/fixture"/>}</>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
