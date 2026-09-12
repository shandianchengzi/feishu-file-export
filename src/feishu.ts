import { bitable, FieldType } from '@lark-base-open/js-sdk';
import type { IRecord } from '@lark-base-open/js-sdk';
import type { Attachment, Options, Row, Source } from './types.ts';
import { collectPages, mapLimited } from './core.ts';

export function feishuSource(): Source {
  let activeTableId = '';
  return {
    async context(tableId?: string) {
      const selection = await bitable.base.getSelection();
      const tables = await bitable.base.getTableMetaList();
      const id = tableId || selection.tableId || tables[0]?.id;
      if (!id) throw new Error('当前多维表格没有可读取的数据表。');
      const table = await bitable.base.getTableById(id);
      const [fields, views, tableName] = await Promise.all([table.getFieldMetaList(), table.getViewMetaList(), table.getName()]);
      return { tableId: id, tableName, tables, views,
        viewId: (selection.tableId === id && selection.viewId) || views[0]?.id || '',
        fields: fields.map(field => ({ id: field.id, name: field.name, attachment: field.type === FieldType.Attachment, primary: field.isPrimary })) };
    },
    pick(tableId, viewId) { return bitable.ui.selectRecordIdList(tableId, viewId); },
    async rows(options: Options, signal, progress): Promise<Row[]> {
      activeTableId = options.tableId;
      const table = await bitable.base.getTableById(options.tableId);
      const fields = await table.getFieldMetaList();
      if (!options.attachmentFieldIds.length) throw new Error('请至少选择一个附件列。');
      for (const fieldId of options.attachmentFieldIds) {
        if (!fields.some(field => field.id === fieldId && field.type === FieldType.Attachment)) {
          throw new Error('附件列已被删除或更改类型，请刷新字段。');
        }
      }
      const textFieldIds = [...new Set([...options.nameFieldIds, options.groupFieldId].filter(Boolean))];
      for (const fieldId of textFieldIds) {
        if (!fields.some(field => field.id === fieldId && field.type !== FieldType.Attachment)) {
          throw new Error('命名列或分类列已被删除或更改类型，请刷新字段后重新选择。');
        }
      }
      let records: IRecord[];
      if (options.scope === 'picked') {
        if (!options.recordIds.length) throw new Error('请先选择需要导出的记录。');
        const ids = [...new Set(options.recordIds)];
        // getRecordById returns only fields; retain the requested ID explicitly
        // instead of assuming a batch response has recordId or a stable order.
        records = await mapLimited(ids, 3, async recordId => ({
          recordId, fields: (await table.getRecordById(recordId)).fields,
        }), signal);
      } else {
        if (options.scope === 'view' && !options.viewId) throw new Error('请选择视图。');
        records = await collectPages(async pageToken => {
          const result = await table.getRecordsByPage({ pageSize: 200, pageToken,
            ...(options.scope === 'view' ? { viewId: options.viewId } : {}) });
          return { ...result, items: result.records };
        }, signal);
      }
      const uniqueRecords = [...new Map(records.map(record => [record.recordId, record])).values()];
      let count = 0;
      return mapLimited(uniqueRecords, 3, async record => {
        const cells = options.attachmentFieldIds.map(fieldId => {
          const value = record.fields[fieldId];
          if (value != null && (!Array.isArray(value) || value.some(a => !a || typeof a !== 'object' || !('token' in a)))) {
            throw new Error('附件单元格返回了未知格式，已停止读取。');
          }
          return { fieldId, fieldName: fields.find(field => field.id === fieldId)!.name, attachments: (value || []) as Attachment[] };
        });
        let nameValues: Record<string, string> = {};
        if (cells.some(cell => cell.attachments.length)) {
          nameValues = Object.fromEntries(await mapLimited(textFieldIds, 3, async fieldId =>
            [fieldId, (await table.getCellString(fieldId, record.recordId)) || ''], signal));
        }
        progress(++count);
        return { id: record.recordId, cells, nameValues, group: nameValues[options.groupFieldId] || '' };
      }, signal);
    },
    async url(item) {
      const table = await bitable.base.getTableById(activeTableId);
      // Resolve this exact token with its cell context; index-based matching can
      // download the wrong file if someone reorders attachments after preview.
      const urls = await table.getCellAttachmentUrls([item.attachment.token], item.fieldId, item.recordId);
      if (urls.length !== 1 || !urls[0]) throw new Error('无法取得附件地址：附件可能已删除，或当前账号没有下载权限。');
      const url = new URL(urls[0]);
      if (url.protocol !== 'https:') throw new Error('飞书未返回 HTTPS 附件地址。');
      return url.href;
    },
  };
}
