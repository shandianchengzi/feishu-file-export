import './style.css';
import { createPlan, describeError, partition, safeSegment, sizeLabel } from './core.ts';
import { makeZip } from './download.ts';
import type { Context, ExportItem, Failure, Options, Source } from './types.ts';

const root = document.querySelector<HTMLDivElement>('#app')!;
const demo = new URLSearchParams(location.search).get('demo') === '1';
const standalone = window.parent === window && !demo;
const installUrl = 'https://feishu.feishu.cn/docx/S1pMdbckEooVlhx53ZMcGGnMnKc';
const projectUrl = 'https://github.com/shandianchengzi/feishu-file-export';
const hostedUrl = 'https://shandianchengzi.github.io/feishu-file-export/';
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const icon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 10v7a4 4 0 0 0 8 0V7a3 3 0 0 0-6 0v10a1 1 0 0 0 2 0V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
let source: Source;
let context: Context | undefined;
let options: Options = { tableId: '', viewId: '', scope: 'view', recordIds: [], attachmentFieldIds: [], nameFieldIds: [], nameSeparator: '_', groupFieldId: '', naming: 'replace' };
let items: ExportItem[] = [];
let checked = new Set<string>();
let page = 0;
let limitMB = 128;
let state: 'connecting' | 'idle' | 'scanning' | 'working' | 'ready' = standalone ? 'idle' : 'connecting';
let notice = '';
let noticeError = false;
let controller: AbortController | undefined;
let objectUrl = '';
let outputName = '';
let outputBytes = 0;
let outputCount = 0;
let saveRequested = false;
let job: { batches: ExportItem[][]; index: number; successes: number; failures: Failure[]; prefix: string } | undefined;
const pageSize = 50;
const busy = () => ['connecting', 'scanning', 'working'].includes(state);
const locked = () => busy() || Boolean(job);
const selectOptions = (list: { id: string; name: string }[], selected: string) => list.map(item => `<option value="${escape(item.id)}" ${item.id === selected ? 'selected' : ''}>${escape(item.name)}</option>`).join('');
function announce(message: string, error = false) { notice = message; noticeError = error; }
function clearOutput() {
  if (objectUrl) { const old = objectUrl; setTimeout(() => URL.revokeObjectURL(old), 60_000); objectUrl = ''; }
}
function invalidate() { items = []; checked.clear(); page = 0; clearOutput(); notice = ''; }

function render() {
  const chosen = items.filter(item => checked.has(item.id));
  const totalSize = chosen.reduce((total, item) => total + Math.max(0, item.attachment.size || 0), 0);
  const header = `<header><div class="brand-icon">${icon}</div><div><h1>附件批量导出</h1><p>按单元格命名，按字段分类</p></div><span class="version">v1.0</span></header>`;
  const help = `<details class="help"><summary>使用说明</summary><p>命名列可多选，按勾选顺序组合<strong>同一行</strong>的单元格内容，也可用上下按钮调整顺序。自定义分隔符用于连接各列内容，在保留原文件名模式下也用于连接原文件名；留空则直接拼接。空单元格自动跳过，全部为空或未选命名列时保留原文件名；分类为空时放入“未分类”。</p><p>文件扩展名保留，重名文件自动添加序号。文件名和分类中的斜杠等字符会替换为下划线；不同分类清理后重名也会自动区分。多选字段按完整显示文本建立一个文件夹。</p><p>支持当前视图、整张表或手动选择记录，再在预览中勾选具体附件。读取期间请避免编辑源表。大批量附件会拆成多个独立 ZIP，逐包保存；每包附带导出清单。</p><p>请在有附件下载权限的账号下使用。建议使用最新版 Chrome / Edge 的飞书网页版。单个附件不能超过所选单包大小，打包时浏览器需要额外内存。</p><a href="${installUrl}" target="_blank" rel="noopener noreferrer">飞书边栏插件开发指南 ↗</a> · <a href="${projectUrl}" target="_blank" rel="noopener noreferrer">项目与问题反馈 ↗</a></details>`;
  if (standalone) {
    root.innerHTML = `<main class="shell">${header}<section class="welcome"><span class="eyebrow">飞书多维表格 · 边栏插件</span><h2>把附件整理好，再下载。</h2><p>将这个地址添加为多维表格的自定义边栏插件，即可读取表格中的附件。</p><div class="url-box"><code>${hostedUrl}</code><button id="copy-url" class="secondary">复制地址</button></div><ol><li>打开需要导出附件的飞书多维表格。</li><li>进入边栏插件的自定义／开发插件入口，填入上面的 HTTPS 地址。</li><li>选择附件列、命名列和分类列，预览后导出。</li></ol><p class="muted">独立打开此页面无法读取飞书表格。入口名称与使用权限以你的飞书界面和开发指南为准。</p><a class="primary button" href="?demo=1">试用示例数据</a><p class="small">示例模式可以下载测试 ZIP，不读取你的飞书数据。</p></section>${help}<footer>附件只在当前浏览器中读取与打包。</footer></main>`;
    document.querySelector('#copy-url')?.addEventListener('click', async event => {
      try { await navigator.clipboard.writeText(hostedUrl); (event.target as HTMLButtonElement).textContent = '已复制'; }
      catch { (event.target as HTMLButtonElement).textContent = '请手动复制'; }
    });
    return;
  }
  const fields = context?.fields.filter(field => !field.attachment) || [];
  root.innerHTML = `<main class="shell">${header}
    ${demo ? '<div class="demo-banner">示例模式 · 仅使用内置测试数据 <a href="./">安装到飞书 ↗</a></div>' : ''}
    <div id="notice" role="status" class="notice ${noticeError ? 'error' : ''}" ${notice ? '' : 'hidden'}>${escape(notice)}</div>
    ${state === 'connecting' ? '<div class="connecting">正在连接飞书多维表格…</div>' : ''}
    ${!context && state !== 'connecting' ? '<button id="reconnect" class="primary">重新连接</button>' : ''}
    ${context ? `<fieldset class="config" ${locked() ? 'disabled' : ''}>
      <section><div class="section-title"><h2><span>1</span> 选择附件</h2><button type="button" id="refresh" class="text-button">刷新字段</button></div>
        <label class="label" for="table">数据表</label><select id="table">${selectOptions(context.tables, options.tableId)}</select>
        <div class="two-columns"><div><label class="label" for="scope">记录范围</label><select id="scope"><option value="view" ${options.scope === 'view' ? 'selected' : ''}>当前视图</option><option value="all" ${options.scope === 'all' ? 'selected' : ''}>整张数据表</option><option value="picked" ${options.scope === 'picked' ? 'selected' : ''}>手动选择记录</option></select></div>
        <div><label class="label" for="view">视图</label><select id="view" ${options.scope === 'all' ? 'disabled' : ''}>${selectOptions(context.views, options.viewId)}</select></div></div>
        ${options.scope === 'picked' ? `<div class="picked"><button type="button" id="pick" class="secondary">选择记录</button><span>已选 ${options.recordIds.length} 条${demo ? '（示例选第 1、3 条）' : ''}</span></div>` : ''}
        <div class="label">附件列</div><div class="field-list">${context.fields.filter(field => field.attachment).map(field => `<label class="field-chip"><input type="checkbox" data-field="${escape(field.id)}" ${options.attachmentFieldIds.includes(field.id) ? 'checked' : ''}> ${escape(field.name)}</label>`).join('') || '<p class="muted">这张数据表没有附件列，请切换数据表。</p>'}</div>
      </section>
      <section><div class="section-title"><h2><span>2</span> 设置文件名与分类</h2></div>
        <div class="label" id="name-fields-label">用哪些列的内容组合命名？（可多选）</div>
        <div class="field-list" role="group" aria-labelledby="name-fields-label">${fields.map(field => `<label class="field-chip"><input type="checkbox" data-name-field="${escape(field.id)}" ${options.nameFieldIds.includes(field.id) ? 'checked' : ''}> ${escape(field.name)}</label>`).join('') || '<p class="muted">没有可用于命名的列，将保留原文件名。</p>'}</div>
        ${options.nameFieldIds.length ? `<div class="label" id="name-order-label">组合顺序</div><ol class="name-order" aria-labelledby="name-order-label">${options.nameFieldIds.map((id, index) => {
          const name = escape(fields.find(field => field.id === id)?.name || id);
          return `<li><span class="order-number">${index + 1}</span><span class="order-name">${name}</span><button type="button" class="text-button" data-name-move="${escape(id)}" data-direction="-1" aria-label="将${name}上移" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="text-button" data-name-move="${escape(id)}" data-direction="1" aria-label="将${name}下移" ${index === options.nameFieldIds.length - 1 ? 'disabled' : ''}>↓</button></li>`;
        }).join('')}</ol><label class="label" for="name-separator">自定义分隔符</label><input type="text" id="name-separator" value="${escape(options.nameSeparator)}" placeholder="例如：_、- 或空格" aria-describedby="separator-hint"><p class="hint" id="separator-hint">留空则直接拼接。空单元格自动跳过；全部为空时保留原文件名。</p><label class="label" for="naming">命名方式</label><select id="naming"><option value="replace" ${options.naming === 'replace' ? 'selected' : ''}>组合内容 + 原扩展名</option><option value="prefix" ${options.naming === 'prefix' ? 'selected' : ''}>组合内容 + 分隔符 + 原文件名</option></select>` : '<p class="hint">未选择命名列，将保留原文件名。</p>'}
        <label class="label" for="group-field">按哪一列分类到文件夹？</label><select id="group-field"><option value="">不分类，放在同一目录</option>${selectOptions(fields, options.groupFieldId)}</select>
        <p class="hint">取附件所在行的单元格内容。重名自动加序号，原扩展名保留。</p>
      </section><button type="button" id="scan" class="primary wide" ${!options.attachmentFieldIds.length ? 'disabled' : ''}>预览附件与导出路径</button>
    </fieldset>` : ''}
    ${state === 'scanning' || state === 'working' ? '<section class="progress-section"><div id="progress-label" role="status">正在处理…</div><progress id="progress" max="100"></progress><button id="cancel" class="secondary">停止</button></section>' : ''}
    ${items.length ? `<section class="preview"><div class="section-title"><h2><span>3</span> 预览与下载</h2><span class="small">共 ${items.length} 个附件</span></div>
      <div class="selection-summary"><strong>已选 ${chosen.length} 个</strong><span>${sizeLabel(totalSize)}</span><button class="text-button" id="select-all" ${locked() ? 'disabled' : ''}>全选</button><button class="text-button" id="select-none" ${locked() ? 'disabled' : ''}>清空</button></div>
      <div class="file-list">${items.slice(page * pageSize, (page + 1) * pageSize).map(item => `<label class="file-row"><input type="checkbox" data-item="${escape(item.id)}" ${checked.has(item.id) ? 'checked' : ''} ${locked() ? 'disabled' : ''}><span><strong>${escape(item.path)}</strong><small>${escape(item.attachment.name)} · ${escape(item.fieldName)} · ${sizeLabel(item.attachment.size || 0)}</small></span></label>`).join('')}</div>
      ${items.length > pageSize ? `<div class="pagination"><button id="prev-page" class="secondary" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${Math.ceil(items.length / pageSize)}</span><button id="next-page" class="secondary" ${(page + 1) * pageSize >= items.length ? 'disabled' : ''}>下一页</button></div>` : ''}
      ${!job ? `<label class="label" for="limit">每包附件大小上限</label><select id="limit" ${busy() ? 'disabled' : ''}>${[32,64,128,256,512].map(n => `<option value="${n}" ${n === limitMB ? 'selected' : ''}>${n} MB${n === 128 ? '（推荐）' : ''}</option>`).join('')}</select><p class="hint">超过总量会分包；单个文件超过上限会列入失败清单。生成后点击保存。</p><button id="export" class="primary wide" ${!chosen.length || busy() ? 'disabled' : ''}>打包 ${chosen.length} 个附件</button>` : ''}
    </section>` : ''}
    ${state === 'ready' && job ? `<section class="result"><span class="eyebrow">第 ${job.index + 1} / ${job.batches.length} 包已生成</span><h2>${outputCount ? `${outputCount} 个附件可以保存` : '本包没有成功读取的附件'}</h2><p>累计成功 ${job.successes} 个，失败 ${job.failures.length} 个。失败原因见 ZIP 中的清单。</p><a class="primary button wide" id="save" href="${objectUrl}" download="${escape(outputName)}">${saveRequested ? '再次保存' : '保存 ZIP'} · ${sizeLabel(outputBytes)}</a><p class="small">${escape(outputName)}</p>${saveRequested ? '<p class="hint">已发起保存，请在浏览器下载列表中确认完成。</p>' : ''}
      ${job.index + 1 < job.batches.length ? `<button id="next-batch" class="secondary wide" ${saveRequested ? '' : 'disabled'}>保存后，处理下一包</button>` : '<button id="finish" class="secondary wide">结束本次导出</button>'}
      ${job.failures.length ? `<details class="failures"><summary>查看 ${job.failures.length} 个失败附件</summary><ul>${job.failures.slice(0,30).map(failure => `<li>${escape(failure.item.path)}<br><span>${escape(failure.reason)}</span></li>`).join('')}</ul>${job.failures.length > 30 ? '<p>更多失败原因请查看每包清单。</p>' : ''}</details>` : ''}
    </section>` : ''}
    ${help}<footer>附件只在当前浏览器中读取与打包。</footer></main>`;
  bind();
}

function on(id: string, action: () => void | Promise<void>) {
  document.getElementById(id)?.addEventListener('click', () => { void Promise.resolve(action()).catch(error => { announce(describeError(error), true); render(); }); });
}
function change(id: string, action: (value: string) => void) {
  document.getElementById(id)?.addEventListener('change', event => { action((event.target as HTMLSelectElement).value); invalidate(); render(); });
}
function bind() {
  on('reconnect', () => connect());
  on('refresh', () => connect(options.tableId));
  document.querySelector('#table')?.addEventListener('change', event => void connect((event.target as HTMLSelectElement).value));
  change('scope', value => { options.scope = value as Options['scope']; });
  change('view', value => { options.viewId = value; options.recordIds = []; });
  change('group-field', value => { options.groupFieldId = value; });
  change('naming', value => { options.naming = value as Options['naming']; });
  document.querySelectorAll<HTMLInputElement>('[data-name-field]').forEach(input => input.addEventListener('change', () => {
    options.nameFieldIds = input.checked ? [...options.nameFieldIds, input.dataset.nameField!] : options.nameFieldIds.filter(id => id !== input.dataset.nameField);
    invalidate(); render();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-name-move]').forEach(button => button.addEventListener('click', () => {
    const index = options.nameFieldIds.indexOf(button.dataset.nameMove!);
    const next = index + Number(button.dataset.direction);
    if (index < 0 || next < 0 || next >= options.nameFieldIds.length) return;
    [options.nameFieldIds[index], options.nameFieldIds[next]] = [options.nameFieldIds[next], options.nameFieldIds[index]];
    invalidate(); render();
  }));
  document.querySelector('#name-separator')?.addEventListener('input', event => {
    options.nameSeparator = (event.target as HTMLInputElement).value;
    invalidate();
    // Keep the input and focus intact while typing, including IME composition.
    document.querySelector('.preview')?.remove();
    const noticeElement = document.getElementById('notice');
    if (noticeElement) noticeElement.hidden = true;
  });
  document.querySelector('#limit')?.addEventListener('change', event => { limitMB = Number((event.target as HTMLSelectElement).value); });
  document.querySelectorAll<HTMLInputElement>('[data-field]').forEach(input => input.addEventListener('change', () => {
    options.attachmentFieldIds = input.checked ? [...options.attachmentFieldIds, input.dataset.field!] : options.attachmentFieldIds.filter(id => id !== input.dataset.field);
    invalidate(); render();
  }));
  document.querySelectorAll<HTMLInputElement>('[data-item]').forEach(input => input.addEventListener('change', () => {
    if (input.checked) checked.add(input.dataset.item!); else checked.delete(input.dataset.item!);
    render();
  }));
  on('pick', async () => {
    if (!options.viewId) throw new Error('请选择用于选择记录的视图。');
    state = 'connecting'; render();
    try { options.recordIds = await source.pick(options.tableId, options.viewId); invalidate(); }
    catch (error) { announce(describeError(error), true); }
    state = 'idle'; render();
  });
  on('scan', scan);
  on('select-all', () => { checked = new Set(items.map(item => item.id)); render(); });
  on('select-none', () => { checked.clear(); render(); });
  on('prev-page', () => { page--; render(); });
  on('next-page', () => { page++; render(); });
  on('export', async () => {
    const selected = items.filter(item => checked.has(item.id));
    if (!selected.length) return;
    controller = new AbortController();
    job = { batches: partition(selected, limitMB * 1024 ** 2), index: 0, successes: 0, failures: [],
      prefix: safeSegment(context!.tableName, '附件', 80) + '_' + new Date().toISOString().slice(0,10) };
    await exportBatch();
  });
  on('cancel', () => { controller?.abort(); });
  document.querySelector('#save')?.addEventListener('click', () => { saveRequested = true; setTimeout(render, 0); });
  on('next-batch', async () => { if (job && saveRequested) { job.index++; await exportBatch(); } });
  on('finish', () => {
    const failed = job!.failures;
    const count = job!.successes;
    checked = new Set(failed.map(f => f.item.id));
    job = undefined; state = 'idle'; clearOutput();
    announce(`本次共打包 ${count} 个附件，失败 ${failed.length} 个。${failed.length ? '失败附件已重新勾选，可调整设置后再次导出。' : '请在下载列表中确认各 ZIP 已保存。'}`);
    render();
  });
}

function updateProgress(done: number, total: number, file: string, phase: string) {
  const label = document.getElementById('progress-label');
  if (label) label.textContent = `${phase} ${Math.floor(done)} / ${total}${file ? ' · ' + file : ''}`;
  const progress = document.querySelector<HTMLProgressElement>('#progress');
  if (progress) { progress.max = total || 100; progress.value = done; }
}

async function connect(tableId?: string) {
  state = 'connecting'; announce(''); render();
  try {
    if (!source) source = demo ? (await import('./demo.ts')).demoSource() : (await import('./feishu.ts')).feishuSource();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      context = await Promise.race([source.context(tableId), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('连接超时。请从飞书多维表格边栏内打开本插件，并确认插件已获得授权。')), 20_000);
      })]);
    } finally { clearTimeout(timer); }
    const nameFields = context.fields.filter(field => !field.attachment);
    const nameFieldIds = options.tableId === context.tableId
      ? options.nameFieldIds.filter(id => nameFields.some(field => field.id === id))
      : nameFields.filter(field => field.primary).map(field => field.id);
    options = { ...options, tableId: context.tableId, viewId: context.viewId, recordIds: [],
      attachmentFieldIds: context.fields.filter(field => field.attachment).map(field => field.id),
      nameFieldIds,
      groupFieldId: demo ? 'group' : '' };
    invalidate();
  } catch (error) { context = undefined; announce(describeError(error), true); }
  state = 'idle'; render();
}

async function scan() {
  controller = new AbortController();
  const signal = controller.signal;
  invalidate(); state = 'scanning'; render();
  try {
    const rows = await source.rows(structuredClone(options), signal, count => updateProgress(count, count, '', '已读取记录'));
    signal.throwIfAborted();
    items = createPlan(rows, options);
    checked = new Set(items.map(item => item.id));
    announce(items.length ? `读取 ${rows.length} 条记录，找到 ${items.length} 个附件。请核对导出路径。` : `读取 ${rows.length} 条记录，所选范围内没有附件。`);
  } catch (error) { announce(signal.aborted ? '已停止读取。' : describeError(error), !signal.aborted); }
  state = 'idle'; render();
}

async function exportBatch() {
  if (!job || !controller) return;
  const current = job;
  clearOutput(); saveRequested = false; state = 'working'; announce(''); render();
  try {
    const result = await makeZip(current.batches[current.index], source, limitMB * 1024 ** 2, controller.signal, updateProgress);
    current.successes += result.successes.length;
    current.failures.push(...result.failures);
    outputName = current.prefix + (current.batches.length > 1 ? `_第${current.index + 1}包` : '') + '.zip';
    objectUrl = URL.createObjectURL(result.blob);
    outputBytes = result.blob.size; outputCount = result.successes.length;
    state = 'ready';
  } catch (error) {
    announce(controller.signal.aborted ? '已停止当前包。之前已保存的 ZIP 不受影响；当前包需要重新打包。' : describeError(error), !controller.signal.aborted);
    job = undefined; state = 'idle';
  }
  render();
}

render();
if (!standalone) void connect();
window.addEventListener('beforeunload', event => { if (busy() || (job && (!saveRequested || job.index + 1 < job.batches.length))) { event.preventDefault(); } });
