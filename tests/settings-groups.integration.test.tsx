// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import SettingsPage from "../src/ui/sidepanel/pages/SettingsPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../src/lib/messages",()=>({sendExtensionRequest:async({type}:{type:string})=>{
  if(type==="GET_AI_SETTINGS")return {provider:"gemini",providerName:"Gemini",model:"gemini-2.5-flash-lite",configuredProviders:["gemini"],providerModels:{},apiKeyConfigured:true};
  if(type==="GET_UNDO_SNAPSHOTS")return [];
  if(type==="GET_FLOATING_SETTINGS")return {enabled:true,hiddenHosts:[],position:{width:400}};
  return null;
}}));
let root:Root|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;document.body.innerHTML="";vi.unstubAllGlobals();});
it("shows one settings group at a time and preserves the unfinished key edit when switching",async()=>{
  vi.stubGlobal("chrome",{runtime:{getURL:(p:string)=>'/'+p,onMessage:{addListener(){},removeListener(){}}},storage:{local:{get:async()=>({}),set:async()=>{}}}});
  vi.stubGlobal("matchMedia",vi.fn(()=>({matches:false,addEventListener(){},removeEventListener(){}})));
  const container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<SettingsPage layout="manager" appState={null} publicFaviconFallback onPublicFaviconFallbackChange={()=>{}} onAppStateChange={()=>{}} onRestartOnboarding={()=>{}} onClose={()=>{}}/>));
  const group=(name:string)=>[...container.querySelectorAll<HTMLButtonElement>('.settings-group-navigation button')].find(b=>b.textContent===name)!;
  const visible=()=>[...container.querySelectorAll<HTMLElement>('.settings-group-panel')].filter(e=>!e.hidden);
  const edit=[...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='编辑')!;
  await act(async()=>edit.click());
  const input=container.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'unsaved-qa-key');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>group('外观与快捷栏').click());
  expect(visible()).toHaveLength(1);expect(visible()[0].getAttribute('aria-label')).toBe('外观与快捷栏');
  await act(async()=>group('AI 服务').click());
  expect(visible()).toHaveLength(1);
  expect(container.querySelector('input[type="password"]')).toBe(input);
  expect(input.value).toBe('unsaved-qa-key');
});
