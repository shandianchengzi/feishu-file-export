import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { fetchAttachment, makeZip, OversizeError } from '../src/download.ts';
import type { ExportItem } from '../src/types.ts';
const item: ExportItem = { id:'i',recordId:'r',fieldId:'f',fieldName:'附件',path:'学院/张三.txt',attachment:{name:'原名.txt',size:3,token:'secret-token',type:'text/plain'} };
test('ZIP contains exact bytes at the planned path and no credentials in report', async()=>{
  const result=await makeZip([item],{url:async()=> 'data:text/plain,abc'},1024,new AbortController().signal,()=>{});
  const zip=await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.equal(await zip.file('学院/张三.txt')!.async('string'),'abc');
  const report=await zip.file('_导出清单.json')!.async('string');
  assert.equal(JSON.parse(report).successful.length,1);
  assert.ok(!report.includes('secret-token'));
  assert.ok(!report.includes('data:'));
});
test('refreshes signed URL when download fails; all fetches omit credentials',async()=>{
  let resolves=0, requests=0;
  const result=await fetchAttachment(item,{url:async()=>`https://example.com/${++resolves}`},100,new AbortController().signal,async(_url,init)=>{
    assert.equal(init?.credentials,'omit');
    return ++requests===1 ? new Response('',{status:403}):new Response('abc');
  });
  assert.equal(resolves,2);
  assert.equal(new TextDecoder().decode(result),'abc');
});
test('oversize stream is rejected even when metadata and Content-Length are absent',async()=>{
  await assert.rejects(fetchAttachment({...item,attachment:{...item.attachment,size:0}},{url:async()=> 'https://example.com/a'},2,new AbortController().signal,async()=>new Response('abc')),OversizeError);
});
test('failed attachments produce an honest failure report and are absent from ZIP',async()=>{
  const result=await makeZip([item],{url:async()=> 'data:text/plain,abc'},2,new AbortController().signal,()=>{});
  assert.equal(result.successes.length,0);
  assert.equal(result.failures.length,1);
  const zip=await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.equal(zip.file(item.path),null);
  assert.equal(JSON.parse(await zip.file('_导出清单.json')!.async('string')).failed.length,1);
});
test('cancel aborts export instead of being logged as an attachment failure',async()=>{
  const c=new AbortController(); c.abort();
  await assert.rejects(makeZip([item],{url:async()=> 'data:text/plain,abc'},1024,c.signal,()=>{}),/abort/i);
});
