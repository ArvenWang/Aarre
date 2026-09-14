import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSaveAiPreparation, isSaveAiPending } from '../src/extension/coordinators/save-ai-preparation';
import { createBookmarkSaveHandlers } from '../src/extension/handlers/bookmark-save';
import { hashText, resourceKeyForUrl } from '../src/lib/url';
import type { PageCapture, ResourceRecord } from '../src/lib/types';

const mocks = vi.hoisted(() => ({ resources:new Map<string,ResourceRecord>(), enrich:vi.fn(), settings:vi.fn(), auth:vi.fn(), outbox:vi.fn() }));
vi.mock('../src/lib/local-ai', () => ({ enrichResourceLocally:mocks.enrich }));
vi.mock('../src/lib/settings', () => ({ getAiRuntimeSettings:mocks.settings }));
vi.mock('../src/lib/auth', () => ({ getAuthState:mocks.auth }));
vi.mock('../src/lib/storage', () => ({
  getLocalResource:async (key:string) => structuredClone(mocks.resources.get(key)), getLocalResources:async () => [...mocks.resources.values()],
  getPageSnapshot:async () => undefined, enqueueOutbox:mocks.outbox, removeOutboxItem:async () => undefined,
  patchLocalResource:async (key:string,patch:(current:ResourceRecord)=>ResourceRecord|null) => {
    const current=mocks.resources.get(key);const next=current?patch(structuredClone(current)):null;
    if(next)mocks.resources.set(key,structuredClone(next));return next;
  },
}));
vi.mock('../src/lib/bookmark-undo', () => ({ snapshotCreatedMutation:async () => ({label:'save'}) }));
vi.mock('../src/lib/sync-request', () => ({requestSync:vi.fn()}));
const capture:PageCapture={url:'https://example.com/ai-preview',canonicalUrl:'https://example.com/ai-preview',title:'原网页标题',description:'',content:'这是网页真实正文。'.repeat(30),excerpt:'这是网页真实正文',selectedText:'',author:'',siteName:'Example',language:'zh',imageUrl:'',faviconUrl:''};
const input=(requestId='preview-a')=>({requestId,capture,sourceTabId:7});
const enriched=(resource:ResourceRecord):ResourceRecord=>({...resource,summary:'依据网页正文生成的摘要',tags:['设计','阅读','资料'],tagsSource:'ai',topics:['设计'],aliases:['阅读资料'],useCases:['写方案时'],contentType:'文章',questions:['哪里有阅读资料'],entities:[],aiSchemaVersion:2,aiStatus:'ready'});
let protectedPage=false, tab:Record<string,unknown>, deps:Parameters<typeof createBookmarkSaveHandlers>[0];
beforeEach(()=>{
  vi.clearAllMocks(); mocks.resources.clear(); protectedPage=false;
  mocks.settings.mockResolvedValue({apiKey:'test-key',provider:'deepseek',model:'test-model'});
  mocks.auth.mockResolvedValue({signedIn:false}); mocks.enrich.mockImplementation(async(resource)=>enriched(resource));
  tab={id:7,url:capture.url,incognito:false};
  const session:Record<string,unknown>={};
  vi.stubGlobal('chrome',{storage:{session:{get:async(key:string)=>({[key]:structuredClone(session[key])}),set:async(value:Record<string,unknown>)=>{Object.assign(session,structuredClone(value));}}},tabs:{get:vi.fn(async()=>tab)},bookmarks:{get:vi.fn(async(id)=>[{id,title:'Folder'}]),create:vi.fn(async(data)=>({id:'saved',...data}))}});
  deps={
    markNativeBookmarksDirty:vi.fn(), defaultFolderId:async()=>'1', getBookmarkSaveState:vi.fn(async()=>({status:'none',url:capture.url,matches:[]} as any)),
    updateNativeBookmark:vi.fn(),moveNativeBookmark:vi.fn(), runProtectedBookmarkMutation:async (input)=>input.perform(),
    bookmarkTarget:(_id,url)=>url,beginInternalBookmarkTarget:vi.fn(),cancelInternalBookmarkTarget:vi.fn(),markInternalBookmarkId:vi.fn(),releaseInternalBookmarkWrite:vi.fn(),
    upsertLocalResource:vi.fn(async(resource)=>{mocks.resources.set(resource.resourceKey,structuredClone(resource));}),
    getPrivacyProtectionContext:async()=>({pageSnapshotsEnabled:false,excludedHosts:[]}),
    resourceProtectionState:vi.fn(()=>({protected:protectedPage,userProtected:protectedPage})),
    folderPathForId:async()=>['Folder'],resourceMatchesLoadedUrl:(resource,url)=>resource.url===url,
    rememberImmediateSnapshotTarget:vi.fn(),cancelEnhancementForResource:vi.fn(),queueEnhancementsUntilVisit:vi.fn(),
    enqueueBookmarkEnhancement:vi.fn(),processBookmarkEnhancements:vi.fn(),ensureSiteBrandForResource:vi.fn(async()=>true),
    errorMessage:(e)=>e instanceof Error?e.message:String(e),hostFromUrl:()=> 'example.com',getUserProtectionMessage:()=> '受保护',
  };
});
afterEach(()=>vi.unstubAllGlobals());
const saveInput=(aiPreparationId='preview-a')=>({capture,sourceTabId:7,title:'手动名称',userNote:'手动备注',folderId:'1',requestAi:true as const,aiPreparationId});

it('starts the real enrichment dependency before any bookmark/resource write and reuses completed previews',async()=>{
  const prep=createSaveAiPreparation(deps);
  expect(await prep.prepare(input())).toMatchObject({status:'ready',summary:'依据网页正文生成的摘要'});
  await prep.prepare(input('reopened'));
  expect(mocks.enrich).toHaveBeenCalledTimes(1);
  expect(chrome.bookmarks.create).not.toHaveBeenCalled();expect(mocks.resources.size).toBe(0);expect(mocks.outbox).not.toHaveBeenCalled();
});
it('coalesces concurrent opens and rejects a preparation token for another page, body or tab',async()=>{
  let resolve!:(resource:ResourceRecord)=>void;let draft!:ResourceRecord;
  mocks.enrich.mockImplementation(resource=>{draft=resource;return new Promise(r=>{resolve=r;});});
  const prep=createSaveAiPreparation(deps),a=prep.prepare(input()),b=prep.prepare(input('reopened'));
  await vi.waitFor(()=>expect(mocks.enrich).toHaveBeenCalledTimes(1));
  expect(await prep.lookup({...input(),capture:{...capture,url:'https://example.com/other'}})).toBeUndefined();
  expect(await prep.lookup({...input(),capture:{...capture,content:'different'}})).toBeUndefined();
  expect(await prep.lookup({...input(),sourceTabId:8})).toBeUndefined();
  resolve(enriched(draft));expect((await Promise.all([a,b])).map(v=>v.status)).toEqual(['ready','ready']);
});
it.each(['protected','incognito','unconfigured','short','navigated'])('skips provider requests for %s',async(kind)=>{
  if(kind==='protected')protectedPage=true;if(kind==='incognito')tab.incognito=true;
  if(kind==='unconfigured')mocks.settings.mockResolvedValue({provider:'deepseek',apiKey:''});
  if(kind==='navigated')tab.url='https://example.com/elsewhere';
  const result=await createSaveAiPreparation(deps).prepare({...input(),capture:kind==='short'?{...capture,content:'short'}:capture});
  expect(result.status).not.toBe('ready');expect(mocks.enrich).not.toHaveBeenCalled();expect(chrome.bookmarks.create).not.toHaveBeenCalled();
});
it('rechecks inherited bookmark protection before serving a cached preview',async()=>{
  const prep=createSaveAiPreparation(deps);await prep.prepare(input());protectedPage=true;
  vi.mocked(deps.getBookmarkSaveState).mockResolvedValue({status:'exact',matches:[{id:'protected-folder-child'}]} as any);
  expect(await prep.prepare(input('after-protection'))).toMatchObject({status:'protected'});
  expect(deps.resourceProtectionState).toHaveBeenLastCalledWith(expect.objectContaining({nativeBookmarkIds:['protected-folder-child']}),expect.anything());
  expect(mocks.enrich).toHaveBeenCalledTimes(1);
});
it('reuses current complete saved AI without a second request',async()=>{
  const handlers=createBookmarkSaveHandlers(deps);await handlers.prepareBookmarkAi(input());await handlers.saveBookmark(saveInput());
  expect(await handlers.prepareBookmarkAi(input('existing'))).toMatchObject({status:'ready',reused:true});expect(mocks.enrich).toHaveBeenCalledTimes(1);
});
it('allows retry after failure and applies ready AI while preserving manual save fields',async()=>{
  mocks.enrich.mockRejectedValueOnce(new Error('provider unavailable'));
  const handlers=createBookmarkSaveHandlers(deps);
  expect(await handlers.prepareBookmarkAi(input())).toMatchObject({status:'failed'});
  await handlers.prepareBookmarkAi(input('retry'));
  const result=await handlers.saveBookmark(saveInput('retry'));
  expect(result.resource).toMatchObject({title:'手动名称',userNote:'手动备注',summary:'依据网页正文生成的摘要',aiStatus:'ready'});
  expect(mocks.enrich).toHaveBeenCalledTimes(2);expect(chrome.bookmarks.create).toHaveBeenCalledTimes(1);
});
it('saves immediately while AI is pending, then updates the same record without losing later manual edits',async()=>{
  let resolve!:(value:ResourceRecord)=>void;let draft!:ResourceRecord;
  mocks.enrich.mockImplementation(resource=>{draft=resource;return new Promise(r=>{resolve=r;});});
  const handlers=createBookmarkSaveHandlers(deps),preview=handlers.prepareBookmarkAi(input());
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  const saved=await handlers.saveBookmark(saveInput());
  expect(saved.enhancementPending).toBe(true);expect(saved.resource.aiStatus).toBe('pending');expect(isSaveAiPending(saved.resource.resourceKey)).toBe(true);
  const current=mocks.resources.get(saved.resource.resourceKey)!;
  mocks.resources.set(current.resourceKey,{...current,title:'后来名称',userNote:'后来备注',tags:['自定义'],tagsSource:'user'});
  resolve(enriched(draft));await preview;
  await vi.waitFor(()=>expect(mocks.resources.get(current.resourceKey)?.aiStatus).toBe('ready'));
  expect(mocks.resources.get(current.resourceKey)).toMatchObject({title:'后来名称',userNote:'后来备注',tags:['自定义'],summary:'依据网页正文生成的摘要'});
  await vi.waitFor(()=>expect(isSaveAiPending(current.resourceKey)).toBe(false));
  expect(chrome.bookmarks.create).toHaveBeenCalledTimes(1);expect(mocks.enrich).toHaveBeenCalledTimes(1);
});
it.each(['deleted','changed','protected'])('does not apply a late AI result after the saved resource was %s',async(kind)=>{
  let resolve!:(value:ResourceRecord)=>void;let draft!:ResourceRecord;
  mocks.enrich.mockImplementation(resource=>{draft=resource;return new Promise(r=>{resolve=r;});});
  const handlers=createBookmarkSaveHandlers(deps),preview=handlers.prepareBookmarkAi(input());
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  const saved=await handlers.saveBookmark(saveInput());const key=saved.resource.resourceKey;
  if(kind==='deleted')mocks.resources.delete(key);
  if(kind==='changed')mocks.resources.set(key,{...saved.resource,contentHash:'new-content'});
  if(kind==='protected')protectedPage=true;
  resolve(enriched(draft));await preview;await vi.waitFor(()=>expect(isSaveAiPending(key)).toBe(false));
  expect(mocks.resources.get(key)?.summary || '').toBe('');expect(mocks.enrich).toHaveBeenCalledTimes(1);
});
it('does not lose an AI result that finishes during persistence',async()=>{
  let resolve!:(value:ResourceRecord)=>void;let draft!:ResourceRecord;
  mocks.enrich.mockImplementation(resource=>{draft=resource;return new Promise(r=>{resolve=r;});});
  const handlers=createBookmarkSaveHandlers(deps),preview=handlers.prepareBookmarkAi(input());
  await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
  vi.mocked(deps.enqueueBookmarkEnhancement).mockImplementation(async()=>{resolve(enriched(draft));await preview;});
  const saved=await handlers.saveBookmark(saveInput());
  await vi.waitFor(()=>expect(mocks.resources.get(saved.resource.resourceKey)?.aiStatus).toBe('ready'));
});
it('keeps ordinary saving available when preview failed without immediately issuing the same failed request',async()=>{
  mocks.enrich.mockRejectedValue(new Error('AI 请求超时，请稍后重试。'));
  const handlers=createBookmarkSaveHandlers(deps);await handlers.prepareBookmarkAi(input());
  const saved=await handlers.saveBookmark(saveInput());
  expect(saved.nativeBookmarkCreated).toBe(true);expect(saved.aiWarning).toContain('超时');expect(mocks.enrich).toHaveBeenCalledTimes(1);
});

it('reuses a finished preview after MV3 worker restart without persisting page content or creating a bookmark',async()=>{
  const first=createBookmarkSaveHandlers(deps);await first.prepareBookmarkAi(input());
  const stored=await chrome.storage.session.get('aarre:save-ai-previews:v1');
  expect(JSON.stringify(stored)).not.toContain(capture.content);expect(JSON.stringify(stored)).not.toContain('test-key');
  const restarted=createBookmarkSaveHandlers(deps);
  await restarted.prepareBookmarkAi(input('after-worker-restart'));
  expect(chrome.bookmarks.create).not.toHaveBeenCalled();
  const saved=await restarted.saveBookmark(saveInput());
  expect(saved.resource).toMatchObject({summary:'依据网页正文生成的摘要',title:'手动名称',userNote:'手动备注',aiStatus:'ready'});
  expect(mocks.enrich).toHaveBeenCalledTimes(1);
});
