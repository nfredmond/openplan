import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServiceRoleClient} from '@/lib/supabase/server';
import {resolveTenantScopedStorageTarget} from '@/lib/files/tenant-scoped-storage';
import type {WorkProgramDraft} from './schema';
import type {WorkProgramSource,WorkProgramPageImage} from './types';
const run=promisify(execFile);

/** The export worker rasterizes explicitly cited original pages, preserving diagrams that text loses. */
export async function renderWorkProgramPageImages(draft:WorkProgramDraft,sources:WorkProgramSource[]):Promise<WorkProgramPageImage[]> {
 const requested=new Map<string,Set<number>>();
 for(const section of draft.preparation?.sourceSections??[])if(section.retainPageImages)for(const ref of section.sourceRefs){const pages=requested.get(ref.sourceId)??new Set<number>();for(let page=ref.pageFrom;page<=ref.pageTo;page++)pages.add(page);requested.set(ref.sourceId,pages);}
 const result:WorkProgramPageImage[]=[];
 if(!requested.size)return result;
 const service=createServiceRoleClient();
 for(const [sourceId,pages] of requested){
  const source=sources.find(row=>row.id===sourceId);if(!source)throw new Error('Cited original unavailable');
  const doc=await service.from('kb_documents').select('id,workspace_id,storage_ref,checksum').eq('id',source.document_id).single();
  if(doc.error||!doc.data||doc.data.checksum!==source.document_checksum)throw new Error('Original identity could not be verified');
  const target=resolveTenantScopedStorageTarget(doc.data.storage_ref,{bucket:'kb-documents',objectPathPrefix:`${doc.data.workspace_id}/${doc.data.id}/`});
  if(!target)throw new Error('Original storage scope invalid');
  const file=await service.storage.from('kb-documents').download(target.objectPath);
  if(file.error||!file.data)throw new Error('Original could not be read');
  const bytes=Buffer.from(await file.data.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==source.document_checksum)throw new Error('Retained original checksum mismatch');
  const folder=await mkdtemp(join(tmpdir(),'owp-source-pages-')),pdf=join(folder,'original.pdf'),png=join(folder,'page.png');
  try {
   await writeFile(pdf,bytes,{mode:0o600});
   for(const page of [...pages].sort((a,b)=>a-b)){
    if(page<1||page>source.page_count)throw new Error('Cited page outside original');
    await run('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','1800','-png',pdf,join(folder,'page')],{timeout:60000,maxBuffer:1024*1024});
    const image=await readFile(png);result.push({sourceId,page,dataUrl:`data:image/png;base64,${image.toString('base64')}`,checksum:createHash('sha256').update(image).digest('hex')});await unlink(png);
   }
  } finally {await unlink(pdf).catch(()=>undefined);await unlink(png).catch(()=>undefined);await rmdir(folder).catch(()=>undefined);}
 }
 return result;
}
