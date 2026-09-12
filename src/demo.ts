import type { Attachment, Context, Source } from './types.ts';
const contents = new Map<string, string>();
function file(name: string, content: string): Attachment {
  const token = 'demo-' + contents.size;
  contents.set(token, content);
  return { name, token, size: new TextEncoder().encode(content).length, type: 'text/plain' };
}
const demoRows = [
  { id: 'demo-1', name: '张三', group: '计算机学院', cells: [{ fieldId: 'attachments', fieldName: '申请材料', attachments: [file('申请书.txt', '这是张三的演示申请书。\n'), file('补充材料.txt', '这是张三的补充材料。\n')] }] },
  { id: 'demo-2', name: '李四', group: '计算机学院', cells: [{ fieldId: 'attachments', fieldName: '申请材料', attachments: [file('申请书.txt', '这是李四的演示申请书。\n')] }] },
  { id: 'demo-3', name: '王五', group: '自动化学院', cells: [{ fieldId: 'attachments', fieldName: '申请材料', attachments: [file('申请书.txt', '这是王五的演示申请书。\n')] }] },
];
const context: Context = { tableId: 'demo', tableName: '学生材料 · 示例数据', viewId: 'view-demo', tables: [{ id: 'demo', name: '学生材料 · 示例数据' }],
  views: [{ id: 'view-demo', name: '全部学生' }], fields: [
    { id: 'name', name: '姓名', attachment: false, primary: true },
    { id: 'group', name: '学院', attachment: false },
    { id: 'attachments', name: '申请材料', attachment: true },
  ] };
export function demoSource(): Source {
  return { async context() { return context; }, async pick() { return ['demo-1', 'demo-3']; },
    async rows(options, signal, progress) {
      signal.throwIfAborted();
      const rows = options.scope === 'picked' ? demoRows.filter(row => options.recordIds.includes(row.id)) : demoRows;
      progress(rows.length);
      return rows.map(row => ({ id: row.id, nameValues: { name: row.name, group: row.group },
        group: options.groupFieldId === 'name' ? row.name : row.group,
        cells: row.cells.filter(cell => options.attachmentFieldIds.includes(cell.fieldId)) }));
    },
    async url(item) { return 'data:text/plain;charset=utf-8,' + encodeURIComponent(contents.get(item.attachment.token)!); },
  };
}
