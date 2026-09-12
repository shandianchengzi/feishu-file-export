import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, createPlan, partition, safeSegment } from '../src/core.ts';
import type { Row } from '../src/types.ts';

function row(id: string, name: string, group: string, names = ['申请.txt']): Row {
  return { id, nameValues: { name, group }, group, cells: [{ fieldId: 'f', fieldName: '附件', attachments: names.map((name, i) => ({ name, token: id + i, size: 10, type: 'text/plain' })) }] };
}
const options = { nameFieldIds: ['name'], nameSeparator: '_', groupFieldId: 'group', naming: 'replace' as const };
test('same-row naming, multiple attachments, duplicate names and original extensions', () => {
  const plan = createPlan([row('r1','张三','学院',['a.txt','b.txt']), row('r2','张三','学院',['c.txt','d.pdf'])], options);
  assert.deepEqual(plan.map(x => x.path), ['学院/张三.txt','学院/张三 (2).txt','学院/张三 (3).txt','学院/张三.pdf']);
  assert.equal(new Set(plan.map(x => x.id)).size, 4);
});
test('empty cells retain original name; unsafe and colliding group values remain separate', () => {
  const plan = createPlan([row('a','','', ['../x.txt']),row('b','CON','A/B'),row('c','con','A:B'),row('d','con','a_b')], options);
  assert.deepEqual(plan.map(x=>x.path), ['未分类/_x.txt','A_B/_CON.txt','A_B (2)/_con.txt','a_b (3)/_con.txt']);
  assert.ok(plan.every(x=>!x.path.split('/').includes('..')));
});
test('manifest filename cannot overwrite a user attachment', () => {
  assert.equal(createPlan([row('r','','',['_导出清单.json'])], { ...options, groupFieldId:'', nameFieldIds:[] })[0].path, '_导出清单 (2).json');
});
test('multiple name columns follow the selected order and custom separator', () => {
  const record = { ...row('r', '张三', '计算机学院', ['原材料.pdf']), nameValues: { name: '张三', group: '计算机学院', code: '2026001' } };
  assert.equal(createPlan([record], { ...options, nameFieldIds: ['code', 'name', 'group'], nameSeparator: ' - ' })[0].path,
    '计算机学院/2026001 - 张三 - 计算机学院.pdf');
  assert.equal(createPlan([record], { ...options, nameFieldIds: ['group', 'name'], nameSeparator: '' })[0].path,
    '计算机学院/计算机学院张三.pdf');
  assert.equal(createPlan([record], { ...options, nameFieldIds: ['name', 'code'], nameSeparator: ' ', naming: 'prefix' })[0].path,
    '计算机学院/张三 2026001 原材料.pdf');
});
test('empty name cells are skipped, while zero values and original-name fallback remain valid', () => {
  const records = [
    { ...row('r1', ' 张三 ', ''), nameValues: { name: ' 张三 ', blank: '  ', code: '0' } },
    row('r2', '  ', '', ['原材料.pdf']),
  ];
  assert.deepEqual(createPlan(records, { ...options, nameFieldIds: ['missing', 'name', 'blank', 'code'], nameSeparator: '-', groupFieldId: '' }).map(item => item.path),
    ['张三-0.txt', '原材料.pdf']);
  assert.equal(createPlan([records[0]], { ...options, nameFieldIds: [], groupFieldId: '' })[0].path, '申请.txt');
});
test('a custom separator cannot create additional folders or unsafe paths', () => {
  assert.equal(createPlan([row('r', '张三', '学院')], { ...options, nameFieldIds: ['name', 'group'], nameSeparator: '/\\', groupFieldId: '' })[0].path,
    '张三__学院.txt');
});
test('Unicode length fits common filesystems and matching extensions are not doubled', () => {
  const path = createPlan([row('r','中文'.repeat(200),'A')], options)[0].path;
  assert.ok(new TextEncoder().encode(path.split('/')[1]).length <= 180);
  assert.ok(path.endsWith('.txt'));
  assert.equal(createPlan([row('r','申请.TXT','A')], options)[0].path, 'A/申请.txt');
  assert.equal(safeSegment('COM1.'), '_COM1');
});
test('literal markup stays data and naming can prefix originals', () => {
  const plan=createPlan([row('r','<script>','G',['one.txt'])],{...options,naming:'prefix'});
  assert.equal(plan[0].path, 'G/_script__one.txt');
});
test('record pagination reads beyond 200 and rejects stalled pagination', async () => {
  const pages = await collectPages(async token => ({ items: Array.from({length:200},(_,i)=>(token||0)+i),hasMore:!token,pageToken:200 }), new AbortController().signal);
  assert.equal(pages.length,400);
  assert.equal(pages[399],399);
  await assert.rejects(collectPages(async()=>({items:[1],hasMore:true,pageToken:0}),new AbortController().signal), /分页/);
});
test('pagination cancellation does not return partial data as complete', async () => {
  const c=new AbortController();
  await assert.rejects(collectPages(async()=>{c.abort();return {items:[1],hasMore:false};},c.signal), /abort/i);
});
test('volume partition keeps each attachment once and supports an oversize item', () => {
  const plan=createPlan([row('r','A','G',['1.txt','2.txt','3.txt','4.txt','5.txt'])],options);
  const batches=partition(plan,21);
  assert.deepEqual(batches.map(x=>x.length),[2,2,1]);
  assert.deepEqual(batches.flat().map(x=>x.id),plan.map(x=>x.id));
});
