export interface Field { id: string; name: string; attachment: boolean; primary?: boolean }
export interface Context {
  tableId: string; tableName: string; viewId: string;
  tables: { id: string; name: string }[];
  views: { id: string; name: string }[];
  fields: Field[];
}
export interface Attachment { name: string; size: number; type: string; token: string }
export interface Row {
  id: string; nameValues: Record<string, string>; group: string;
  cells: { fieldId: string; fieldName: string; attachments: Attachment[] }[];
}
export interface Options {
  tableId: string; viewId: string; scope: 'view' | 'all' | 'picked';
  recordIds: string[]; attachmentFieldIds: string[];
  nameFieldIds: string[]; nameSeparator: string; groupFieldId: string; naming: 'replace' | 'prefix';
}
export interface ExportItem {
  id: string; recordId: string; fieldId: string; fieldName: string;
  attachment: Attachment; path: string;
}
export interface Source {
  context(tableId?: string): Promise<Context>;
  pick(tableId: string, viewId: string): Promise<string[]>;
  rows(options: Options, signal: AbortSignal, progress: (count: number) => void): Promise<Row[]>;
  url(item: ExportItem): Promise<string>;
}
export interface Failure { item: ExportItem; reason: string }
