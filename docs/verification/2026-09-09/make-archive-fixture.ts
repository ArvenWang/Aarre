// Isolated QA data only. Never imported by the production extension.
import 'fake-indexeddb/auto';
import { writeFile } from 'node:fs/promises';
import { createArchive } from '../../../src/lib/archive-format';
import { database, normalizeResourceRecord } from '../../../src/lib/storage';
const local = { 'aarre:agent-conversations': [] };
Object.assign(globalThis,{chrome:{runtime:{getManifest:()=>({version:'0.6.0'})},storage:{local:{get:async(k:string)=>({[k]:local[k]})}},bookmarks:{getTree:async()=>[{id:'0',title:'',children:[{id:'1',title:'QA source folder',children:[{id:'2',title:'QA article',url:'https://example.com/qa'},{id:'3',title:'QA duplicate occurrence',url:'https://example.com/qa'}]}]}]}}});
const db=await database();await db.put('resources',normalizeResourceRecord({resourceKey:'qa-archive-resource',url:'https://example.com/qa',canonicalUrl:'https://example.com/qa',title:'QA article',nativeBookmarkIds:['2','3'],userNote:'QA fixture: archive preview, not user data',updatedAt:'2026-09-09T00:00:00.000Z'}));
const archive=await createArchive();await writeFile(new URL('./archive-fixture.json',import.meta.url),JSON.stringify(archive,null,2));console.log('QA archive fixture created');
