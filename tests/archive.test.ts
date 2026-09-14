import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArchive, parseArchive, archiveHash } from "../src/lib/archive-format";
import { restoreArchive, abandonArchiveRestore } from "../src/lib/archive-restore";
import { database, normalizeResourceRecord } from "../src/lib/storage";
import { ARCHIVE_ACTIVE_KEY } from "../src/lib/archive-guard";
let local:Record<string,any>, nodes:Map<string,any>, nextId:number, creates:number, failAt:number;
function children(id:string):any[] {return [...nodes.values()].filter(n=>n.parentId===id).sort((a,b)=>a.index-b.index);}
function tree(id:string):any {const n=nodes.get(id);return {...n,...(!n.url?{children:children(id).map(c=>tree(c.id))}:{})};}
function freshBookmarks() { nodes=new Map([['0',{id:'0',title:''}],['1',{id:'1',title:'书签栏',parentId:'0',index:0}],['2',{id:'2',title:'其他书签',parentId:'0',index:1}]]);nextId=100;creates=0;failAt=0; }
beforeEach(async()=>{
 local={};freshBookmarks();
 vi.stubGlobal('navigator',{locks:{request:async(_key:string,_options:any,callback:any)=>callback({name:'test'})}});
 vi.stubGlobal('chrome',{runtime:{getManifest:()=>({version:'0.6.0'})},storage:{local:{
  get:async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,local[k]])),
  set:async(value:any)=>{Object.assign(local,structuredClone(value))},remove:async(key:string)=>{delete local[key]},
 }},bookmarks:{
  getTree:async()=>[tree('0')],getChildren:async(id:string)=>children(id).map(n=>({...n})),
  get:async(id:string)=>{if(!nodes.has(id))throw Error('missing');return[{...nodes.get(id)}]},
  create:vi.fn(async(input:any)=>{creates++;if(failAt===creates)throw Error('simulated Chrome interruption');const id=String(nextId++);const item={id,...input,index:input.index??children(input.parentId).length};nodes.set(id,item);return{...item}}),
 }});
 const db=await database();for(const name of db.objectStoreNames)await db.clear(name);
});
async function backup() {
 nodes.set('3',{id:'3',parentId:'1',index:0,title:'资料'});
 nodes.set('4',{id:'4',parentId:'3',index:0,title:'原始标题',url:'https://example.com/a'});
 nodes.set('5',{id:'5',parentId:'2',index:0,title:'同网址另一处',url:'https://example.com/a'});
 const db=await database();
 await db.put('resources',normalizeResourceRecord({resourceKey:'key-a',canonicalUrl:'https://example.com/a',url:'https://example.com/a',title:'原始标题',userNote:'真实备注',tags:['设计'],nativeBookmarkIds:['4','5'],createdAt:'2026-09-09T01:00:00.000Z',updatedAt:'2026-09-09T01:00:00.000Z'}));
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=';
 await db.put('pageSnapshots',{canonicalUrl:'https://example.com/a',imageDataUrl:png,width:1,height:1,capturedAt:'2026-09-09T01:00:00.000Z'});
 local['aarre:agent-conversations']=[{id:'c1',title:'收藏问题',createdAt:'2026-09-09T01:00:00.000Z',updatedAt:'2026-09-09T01:00:00.000Z',messages:[{id:'m1',role:'assistant',content:'已找到相关收藏',createdAt:'2026-09-09T01:00:00.000Z',actions:[{id:'danger-old',type:'delete',status:'pending'}]}]}];
 local['aarre:protection-settings:v1']={resourceKeys:[],folderIds:['3']};
 local['aarre:cloud-session:v1']={accessToken:'SECRET_TOKEN'};
 local['bookmark-layer:ai-settings']={apiKeys:{gemini:'SECRET_KEY'}};
 return createArchive();
}
async function clearForRestore(){const db=await database();for(const name of db.objectStoreNames)await db.clear(name);local={};freshBookmarks();}
describe('full archive recovery',()=>{
 it('checks every image and excludes credentials and pending operations',async()=>{
  const archive=await backup();const {preview}=await parseArchive(JSON.stringify(archive));
  expect(preview).toMatchObject({bookmarks:2,duplicateUrls:1,resources:1,images:1,conversations:1});
  expect(JSON.stringify(archive)).not.toContain('SECRET_');expect(archive.data).not.toHaveProperty('outbox');
 });
 it('restores a fresh profile, preserves duplicate occurrences and remaps native ids',async()=>{
  const archive=await backup();await clearForRestore();const result=await restoreArchive(archive);
  expect(result.alreadyRestored).toBe(false);expect(children('2')).toHaveLength(1);
  const links=[...nodes.values()].filter(n=>n.url);expect(links.map(n=>n.title)).toEqual(['原始标题','同网址另一处']);
  const db=await database();const resource=await db.get('resources','key-a');
  expect(resource?.userNote).toBe('真实备注');expect(resource?.nativeBookmarkIds.sort()).toEqual(links.map(n=>n.id).sort());expect(resource?.nativeBookmarkIds).not.toContain('4');
  expect((await db.get('pageSnapshots','https://example.com/a'))?.imageDataUrl).toBe(archive.data.pageSnapshots[0].imageDataUrl);
  expect(local['aarre:agent-conversations'][0].messages[0].actions).toEqual([]);
  expect(local['aarre:protection-settings:v1'].folderIds).toEqual([[...nodes.values()].find(n=>n.title==='资料')!.id]);
  expect(local['aarre:cloud-session:v1']).toBeUndefined();expect(local[ARCHIVE_ACTIVE_KEY]).toBeUndefined();
  const before=nodes.size;expect((await restoreArchive(archive)).alreadyRestored).toBe(true);expect(nodes.size).toBe(before);
 });
 it('resumes after native creation is interrupted without duplicating completed steps',async()=>{
  const archive=await backup();await clearForRestore();failAt=4;
  await expect(restoreArchive(archive)).rejects.toThrow('interruption');expect(local[ARCHIVE_ACTIVE_KEY]).toBeDefined();
  failAt=0;await restoreArchive(archive);expect([...nodes.values()].filter(n=>n.url)).toHaveLength(2);expect([...nodes.values()].filter(n=>n.title.startsWith('Aarre 恢复'))).toHaveLength(1);
 });
 it('preserves pre-existing user notes while adding newly restored locations',async()=>{
  const archive=await backup();await clearForRestore();const db=await database();
  await db.put('resources',normalizeResourceRecord({...archive.data.resources[0],userNote:'本机新备注',tags:['本机标签'],nativeBookmarkIds:[]}));
  await restoreArchive(archive);expect((await db.get('resources','key-a'))?.userNote).toBe('本机新备注');expect((await db.get('resources','key-a'))?.tags).toEqual(['本机标签']);
 });
 it('rejects altered payloads and individually corrupt images before writing Chrome',async()=>{
  const archive=await backup();archive.data.resources[0].userNote='altered';await expect(parseArchive(JSON.stringify(archive))).rejects.toThrow('校验失败');
  archive.integrity.payload=await archiveHash(archive.data);archive.data.pageSnapshots[0].imageDataUrl='data:image/png;base64,YmFk';archive.integrity.payload=await archiveHash(archive.data);
  await expect(restoreArchive(archive)).rejects.toThrow('图片内容校验失败');expect(chrome.bookmarks.create).not.toHaveBeenCalled();
 });
 it('can end an interrupted restore without deleting any existing native content',async()=>{
  const archive=await backup();await clearForRestore();failAt=4;
  await expect(restoreArchive(archive)).rejects.toThrow('interruption');
  const originalIds=[...nodes.keys()];await abandonArchiveRestore();
  expect(local[ARCHIVE_ACTIVE_KEY]).toBeUndefined();expect([...nodes.keys()]).toEqual(originalIds);
  failAt=0;await restoreArchive(archive);expect([...nodes.values()].filter(n=>n.title.startsWith('Aarre 恢复'))).toHaveLength(2);
 });
 it('exports a valid resource when a native bookmark was deleted before the index caught up',async()=>{
  await backup();nodes.delete('5');const archive=await createArchive();
  expect(archive.data.resources[0].nativeBookmarkIds).toEqual(['4']);await expect(parseArchive(JSON.stringify(archive))).resolves.toBeDefined();
 });
 it('does not present the old incomplete export as a restorable archive',async()=>{await expect(parseArchive(JSON.stringify({format:'aarre-data-export',schemaVersion:1}))).rejects.toThrow('旧版数据导出');});
});
