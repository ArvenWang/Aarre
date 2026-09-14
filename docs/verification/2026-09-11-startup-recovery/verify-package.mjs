// Independent delivery checks, after the clean-source official packaging step.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out=resolve(root,'outputs'),name='Bookmark-Layer-0.6.3';
const build=JSON.parse(await readFile(resolve(out,name+'-build.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const run=(program,args)=>execFileSync(program,args,{cwd:root,maxBuffer:256*1024*1024});
const assert=(condition,message)=>{if(!condition)throw Error(message);};
assert(build.version==='0.6.3'&&build.cleanSource===true,'Build identity');
for(const record of build.files){
 const data=await readFile(resolve(out,record.path));
 assert(data.length===record.bytes&&sha(data)===record.sha256,'File differs: '+record.path);
}
const extensionZip=resolve(out,name+'.zip'),sourceZip=resolve(out,name+'-source.zip');
run('unzip',['-t',extensionZip]);run('unzip',['-t',sourceZip]);
const unpacked=resolve(out,name+'-unpacked');
const manifest=JSON.parse(await readFile(resolve(unpacked,'manifest.json'),'utf8'));
const zippedManifest=JSON.parse(run('unzip',['-p',extensionZip,'manifest.json']).toString());
const sourceManifest=JSON.parse(run('unzip',['-p',sourceZip,'public/manifest.json']).toString());
const sourcePackage=JSON.parse(run('unzip',['-p',sourceZip,'package.json']).toString());
assert([manifest,zippedManifest,sourceManifest,sourcePackage].every(x=>x.version==='0.6.3'),'Version mismatch');
let extensionFiles=0;
async function verifyZipDirectory(directory,prefix=''){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const relative=prefix+entry.name,path=resolve(directory,entry.name);
  if(entry.isDirectory())await verifyZipDirectory(path,relative+'/');
  else{assert(sha(await readFile(path))===sha(run('unzip',['-p',extensionZip,relative])),'ZIP content differs: '+relative);extensionFiles++;}
 }
}
await verifyZipDirectory(unpacked);
assert(extensionFiles===build.files.length-2,'Unlisted delivery file');
const sourceBytes=await readFile(sourceZip),archiveBytes=run('git',['archive','--format=zip',build.sourceCommit]);
assert(sha(sourceBytes)===sha(archiveBytes),'Source ZIP differs from clean commit archive');
assert(run('git',['rev-parse',build.sourceCommit+'^{tree}']).toString().trim()===build.sourceTree,'Source tree mismatch');
const publicReferences=[...new Set(manifest.web_accessible_resources.flatMap(x=>x.resources))];
for(const reference of publicReferences)if(!reference.includes('*'))await readFile(resolve(unpacked,reference));
const result={version:build.version,verifiedAt:new Date().toISOString(),sourceCommit:build.sourceCommit,sourceTree:build.sourceTree,manifestEntries:build.files.length,allFileBytesAndSha256Match:true,extensionFilesComparedWithZip:extensionFiles,sourceZipMatchesGitArchive:true,publicReferencesChecked:publicReferences,versionsMatch:true,extensionZipBytes:(await readFile(extensionZip)).length,sourceZipBytes:sourceBytes.length,boundary:'Build and archive verification. Not installed Chrome or external-provider acceptance.'};
await writeFile(resolve(out,name+'-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
