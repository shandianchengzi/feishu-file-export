import JSZip from 'jszip';
import { describeError } from './core.ts';
import type { ExportItem, Failure, Source } from './types.ts';

export class OversizeError extends Error {}

export async function fetchAttachment(item: ExportItem, source: Pick<Source, 'url'>, limit: number, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  if (item.attachment.size > limit) throw new OversizeError('此文件超过单包大小，请上调单包大小后重新导出。');
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      const url = await source.url(item);
      signal.throwIfAborted();
      const response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`附件下载失败（HTTP ${response.status}），请检查下载权限或网络。`);
      }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > limit) {
        await response.body?.cancel();
        throw new OversizeError('附件实际大小超过单包大小，请上调后重试。');
      }
      if (!response.body) throw new Error('浏览器未返回可读取的附件内容。');
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          total += part.value.length;
          if (total > limit) throw new OversizeError('附件实际大小超过单包大小，请上调后重试。');
          parts.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (item.attachment.size >= 0 && total !== item.attachment.size) {
        throw new Error('附件大小与预览不一致，可能在导出期间被修改；请重新预览。');
      }
      const data = new Uint8Array(total);
      let position = 0;
      for (const part of parts) { data.set(part, position); position += part.length; }
      return data;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof OversizeError) throw error;
      last = error;
      if (attempt < 2) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 400 * 2 ** attempt);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
  if (last instanceof TypeError) throw new Error('浏览器无法读取附件：可能是网络、跨域限制或临时地址权限问题。请在飞书网页版中重试，并确认原附件可以下载。');
  throw last;
}

export interface BatchResult { blob: Blob; successes: ExportItem[]; failures: Failure[] }
export async function makeZip(items: ExportItem[], source: Pick<Source, 'url'>, limit: number, signal: AbortSignal,
  progress: (done: number, total: number, file: string, phase: string) => void): Promise<BatchResult> {
  const zip = new JSZip();
  const successes: ExportItem[] = [], failures: Failure[] = [];
  let usedBytes = 0;
  for (const [index, item] of items.entries()) {
    signal.throwIfAborted();
    progress(index, items.length, item.path, '读取附件');
    try {
      const data = await fetchAttachment(item, source, limit - usedBytes, signal);
      usedBytes += data.length;
      zip.file(item.path, data, { createFolders: false, binary: true });
      successes.push(item);
    } catch (error) {
      signal.throwIfAborted();
      failures.push({ item, reason: describeError(error) });
    }
    progress(index + 1, items.length, item.path, '读取附件');
  }
  zip.file('_导出清单.json', JSON.stringify({ createdAt: new Date().toISOString(),
    successful: successes.map(item => ({ path: item.path, recordId: item.recordId, field: item.fieldName, originalName: item.attachment.name, bytes: item.attachment.size })),
    failed: failures.map(({ item, reason }) => ({ path: item.path, recordId: item.recordId, field: item.fieldName, originalName: item.attachment.name, reason })),
  }, null, 2));
  signal.throwIfAborted();
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE', streamFiles: true }, state => {
    // JSZip has no AbortSignal API. Finish this bounded pack and discard it
    // after cancellation; throwing in its progress callback can orphan a stream.
    if (!signal.aborted) progress(state.percent, 100, '', '生成 ZIP');
  });
  signal.throwIfAborted();
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), successes, failures };
}
