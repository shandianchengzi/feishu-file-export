import type { ExportItem, Options, Row } from './types.ts';

const encoder = new TextEncoder();
function truncate(value: string, bytes: number): string {
  let result = '';
  for (const char of value) {
    if (encoder.encode(result + char).length > bytes) break;
    result += char;
  }
  return result;
}

export function safeSegment(value: string, fallback = '未命名', bytes = 160): string {
  let clean = value.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
  if (!clean) clean = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) clean = '_' + clean;
  return truncate(clean, bytes).replace(/[. ]+$/g, '') || fallback;
}

function splitName(name: string): [string, string] {
  const match = name.match(/^(.*)(\.[^.]{1,20})$/u);
  return match && match[1] ? [match[1], match[2]] : [name, ''];
}

function safeFilename(name: string): string {
  const [stem, ext] = splitName(name);
  const safeExt = ext ? '.' + safeSegment(ext.slice(1), '', 32) : '';
  return safeSegment(stem, '未命名', 180 - encoder.encode(safeExt).length) + safeExt;
}

export function createPlan(rows: Row[], options: Pick<Options, 'nameFieldId' | 'groupFieldId' | 'naming'>): ExportItem[] {
  const groups = new Map<string, string>();
  const usedGroups = new Set<string>(['_导出清单.json']);
  const usedPaths = new Set<string>(['_导出清单.json']);
  const items: ExportItem[] = [];
  for (const row of rows) {
    let folder = '';
    if (options.groupFieldId) {
      const key = row.group.normalize('NFC').trim() || '未分类';
      if (!groups.has(key)) {
        const stem = safeSegment(key, '未分类', 100);
        let candidate = stem;
        let index = 2;
        while (usedGroups.has(candidate.toLowerCase())) candidate = `${stem} (${index++})`;
        groups.set(key, candidate);
        usedGroups.add(candidate.toLowerCase());
      }
      folder = groups.get(key)! + '/';
    }
    for (const cell of row.cells) for (const [index, attachment] of cell.attachments.entries()) {
      const original = safeFilename(attachment.name || '未命名');
      const [, ext] = splitName(original);
      let name = original;
      if (options.nameFieldId && row.name.trim()) {
        let base = row.name.trim();
        if (options.naming === 'replace') {
          if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) base = base.slice(0, -ext.length);
          name = safeFilename(base + ext);
        } else name = safeFilename(base + '_' + original);
      }
      const [stem, suffix] = splitName(name);
      let candidate = folder + name;
      let number = 2;
      while (usedPaths.has(candidate.toLowerCase())) candidate = `${folder}${stem} (${number++})${suffix}`;
      usedPaths.add(candidate.toLowerCase());
      items.push({ id: JSON.stringify([row.id, cell.fieldId, attachment.token, index]),
        recordId: row.id, fieldId: cell.fieldId, fieldName: cell.fieldName, attachment, path: candidate });
    }
  }
  return items;
}

export function partition(items: ExportItem[], limit: number): ExportItem[][] {
  const result: ExportItem[][] = [];
  let batch: ExportItem[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = Math.max(0, item.attachment.size || 0);
    if (batch.length && (bytes + size > limit || batch.length >= 1500)) {
      result.push(batch); batch = []; bytes = 0;
    }
    batch.push(item); bytes += size;
  }
  if (batch.length) result.push(batch);
  return result;
}

export async function collectPages<T>(read: (token?: number) => Promise<{
  items: T[]; hasMore: boolean; pageToken?: number;
}>, signal: AbortSignal): Promise<T[]> {
  const seen = new Set<number>();
  const items: T[] = [];
  let token: number | undefined;
  do {
    signal.throwIfAborted();
    const page = await read(token);
    signal.throwIfAborted();
    items.push(...page.items);
    if (!page.hasMore) break;
    if (page.pageToken === undefined || seen.has(page.pageToken)) {
      throw new Error('飞书返回了无效的分页标记，已停止读取以避免漏导。请刷新后重试。');
    }
    seen.add(page.pageToken);
    token = page.pageToken;
  } while (true);
  return items;
}

export async function mapLimited<T, R>(values: T[], limit: number, action: (value: T) => Promise<R>, signal: AbortSignal): Promise<R[]> {
  const output = new Array<R>(values.length);
  let index = 0;
  let error: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!error) {
      const next = index++;
      if (next >= values.length) return;
      try {
        signal.throwIfAborted();
        output[next] = await action(values[next]);
        signal.throwIfAborted();
      } catch (caught) { error = caught; }
    }
  }));
  if (error) throw error;
  return output;
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, '[临时地址]').slice(0, 300);
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
