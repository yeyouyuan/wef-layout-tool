import iconv from 'iconv-lite';
import { Buffer } from 'buffer';

const KEY = new TextEncoder().encode('WEAVER E-DESIGN.');
const IV = new TextEncoder().encode('weaver e-design.');
const aesKey = crypto.subtle.importKey('raw', KEY, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);

export async function decodeWef(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(trimmed)) throw new Error('文件不是有效的十六进制 WEF 文本');
  const bytes = Buffer.from(trimmed, 'hex');
  let plain;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name:'AES-CBC', iv:IV }, await aesKey, bytes)); }
  catch { throw new Error('AES 解密失败：文件可能不是该版本的 E9 WEF 导出'); }
  try { return JSON.parse(iconv.decode(Buffer.from(plain), 'gb18030')); }
  catch { throw new Error('解密后无法按 GB18030 解析为 JSON'); }
}
export async function encodeWef(obj) {
  const gb = iconv.encode(JSON.stringify(obj), 'gb18030');
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-CBC', iv:IV }, await aesKey, gb));
  return Buffer.from(cipher).toString('hex') + '\n';
}
function tables(obj) { return obj?.dataobj?.eformdesign?.etables || {}; }
function attr(obj) { return obj?.dataobj?.eformdesign?.eattr || {}; }
function kind(obj) {
  const a = attr(obj);
  if (a.wfid && a.nodeid && a.formid && tables(obj).emaintable) return 'workflow';
  if (a.modeid && a.formid && tables(obj).emaintable) return 'model';
  throw new Error('无法识别文件类型：需要流程节点布局或建模表单布局');
}
function mainFields(obj) {
  const byId = new Map();
  for (const c of tables(obj).emaintable?.ec || []) {
    if (!c.field || !['2', '3'].includes(String(c.etype))) continue;
    const id = String(c.field), field = byId.get(id) || { id };
    if (String(c.etype) === '2') field.label = c;
    else field.input = c;
    byId.set(id, field);
  }
  return [...byId.values()].filter(x => x.label && x.input);
}
function detailFields(obj) {
  const byId = new Map();
  for (const c of tables(obj).detail_1?.ec || []) {
    if (!c.field || !['2', '3'].includes(String(c.etype))) continue;
    const id = String(c.field), field = byId.get(id) || { id };
    if (String(c.etype) === '2') field.label = c;
    else field.input = c;
    byId.set(id, field);
  }
  return [...byId.values()].filter(x => x.label && x.input);
}
function nestedFields(obj) {
  const all = [];
  const ts = tables(obj);
  for (const key of Object.keys(ts).filter(x => /^mc_/.test(x))) {
    for (const c of ts[key].ec || []) {
      if (!c.field || !['2', '3'].includes(String(c.etype))) continue;
      const id = String(c.field);
      let x = all.find(v => v.id === id);
      if (!x) { x = { id }; all.push(x); }
      if (String(c.etype) === '2') x.label = c;
      else x.input = c;
    }
  }
  return all.filter(x => x.label && x.input);
}
const fieldKey = x => `${x.label.evalue}\0${x.input.fieldtype}`;
function matchFields(source, target) {
  const old = [...mainFields(source), ...nestedFields(source)];
  const next = [...mainFields(target), ...nestedFields(target)];
  const pools = new Map();
  for (const f of next) {
    const key = fieldKey(f);
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(f);
  }
  const matched = [], missing = [];
  for (const f of old) {
    const pool = pools.get(fieldKey(f)) || [];
    if (pool.length) matched.push({ source: f, target: pool.shift(), nested: !tables(source).emaintable.ec.some(c => c.field === f.id) });
    else missing.push(f);
  }
  return { matched, missing, extras: [...pools.values()].flat() };
}
function viewField(f) { return { id: f.id, name: f.label.evalue, type: f.input.fieldtype, label: f.label.id, input: f.input.id }; }
function viewLayout(obj, tableName = 'emaintable') {
  const table = tables(obj)[tableName];
  if (!table) return null;
  const cells = (table.ec || []).filter(c => c.evalue || c.field || ['7', '13'].includes(String(c.etype))).map(c => ({
    id: c.id, text: String(c.evalue || ''), type: String(c.etype), field: c.field ? String(c.field) : null,
    colspan: Number(c.colspan || 1), rowspan: Number(c.rowspan || 1)
  }));
  const positions = cells.map(c => c.id?.split(',').map(Number)).filter(v => v && v.length === 2);
  const rows = Math.max(Number(tableName === 'emaintable' ? obj.sheetobj?.main_sheet?.sheets?.Sheet1?.rowCount : obj.sheetobj?.detail_1_sheet?.sheets?.Sheet1?.rowCount) || 0, ...positions.map(x => x[0] + 1));
  const cols = Math.max(Object.keys(table.colheads || {}).length, ...positions.map(x => x[1] + 1));
  return { rows, cols, cells, widths: table.colheads || {} };
}
function summary(source, target) {
  const match = matchFields(source, target);
  const details = { source: detailFields(source).map(viewField), target: detailFields(target).map(viewField) };
  const dkeys = new Set(details.target.map(x => `${x.name}\0${x.type}`));
  const detailMissing = details.source.filter(x => !dkeys.has(`${x.name}\0${x.type}`));
  return {
    source: { kind: kind(source), attr: attr(source), main: mainFields(source).length, nested: nestedFields(source).length, detail: details.source.length, layout: viewLayout(source) },
    target: { kind: kind(target), attr: attr(target), main: mainFields(target).length, nested: nestedFields(target).length, detail: details.target.length, layout: viewLayout(target) },
    matched: match.matched.map(m => ({ source: viewField(m.source), target: viewField(m.target), nested: m.nested })),
    missing: match.missing.map(viewField), extras: match.extras.map(viewField), detailMissing,
    canGenerate: Boolean(match.matched.length && !detailMissing.length),
    requiresOmit: Boolean(match.missing.length)
  };
}
function sheetCell(obj, table, pos) {
  const [r,c] = pos.split(',');
  const key = table === 'emaintable' ? 'main_sheet' : table + '_sheet';
  return obj.sheetobj?.[key]?.sheets?.Sheet1?.data?.dataTable?.[r]?.[c];
}
function applyCellStyle(result, source, target, table, sourcePos, targetPos, value) {
  const cell = sheetCell(result,table,sourcePos), reference = sheetCell(target,table,targetPos);
  if (!cell || !reference) throw new Error(`缺少 ${table} 单元格样式：${sourcePos}`);
  cell.value = value;
  const style = cell.style || (cell.style = {}), from = reference.style || {};
  for (const key of ['backgroundImage','backgroundImageLayout','locked','formatter','backColor']) {
    if (Object.prototype.hasOwnProperty.call(from,key)) style[key] = from[key];
    else delete style[key];
  }
}
function mapTable(result, source, target, tableName, sourceFields, targetFields) {
  const pool = new Map();
  for (const field of targetFields) {
    const key = fieldKey(field);
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(field);
  }
  const mapping = new Map();
  for (const field of sourceFields) {
    const available = pool.get(fieldKey(field)) || [];
    if (available.length) mapping.set(field.id, available.shift());
  }
  let omitted = 0;
  const sourceCells = tables(source)[tableName].ec;
  const resultCells = tables(result)[tableName].ec;
  for (let index=0;index<resultCells.length;index++) {
    const cell = resultCells[index], original = sourceCells[index];
    if (!original?.field) continue;
    if (!['2','3'].includes(String(original.etype))) {
      if (kind(target) === 'model') { delete cell.field; delete cell.uuid; cell.etype='0'; }
      continue;
    }
    const mapped = mapping.get(String(original.field));
    if (!mapped) {
      omitted++;
      delete cell.field; delete cell.uuid; delete cell.fieldtype;
      cell.etype='0'; cell.evalue='';
      const visual=sheetCell(result,tableName,cell.id);
      if (visual) { visual.value=''; if (visual.style) delete visual.style.backgroundImage; }
      continue;
    }
    cell.field=mapped.id;
    cell.evalue=mapped.label.evalue;
    if (String(cell.etype)==='3') cell.fieldtype=mapped.input.fieldtype;
    if (kind(target)==='model') delete cell.uuid;
    else cell.uuid=(tableName==='emaintable'?'main':tableName)+'-'+cell.id.replace(',','-');
    const targetPos=String(cell.etype)==='2'?mapped.label.id:mapped.input.id;
    applyCellStyle(result,source,target,tableName,cell.id,targetPos,cell.evalue);
  }
  return { mapped:mapping.size, omitted:omitted/2 };
}
function flattenNestedWorkflowFields(result, source, target) {
  if (kind(source)!=='workflow' || kind(target)!=='model') return 0;
  const pool = new Map(mainFields(target).map(f=>[fieldKey(f),f]));
  const main = tables(result).emaintable.ec;
  let count=0;
  for (const field of nestedFields(source)) {
    const mapped=pool.get(fieldKey(field));
    if (!mapped) continue;
    for (const [original,etype] of [[field.label,'2'],[field.input,'3']]) {
      const pos=original.uuid?.match(/^main-(\d+)-(\d+)$/);
      if (!pos) throw new Error(`无法定位合并单元格：${field.label.evalue}`);
      const id=`${pos[1]},${pos[2]}`, cell=main.find(c=>c.id===id);
      if (!cell || cell.field) throw new Error(`合并单元格 ${id} 不可转换`);
      cell.etype=etype; cell.field=mapped.id; cell.evalue=mapped.label.evalue;
      if (etype==='3') cell.fieldtype=mapped.input.fieldtype;
      const targetPos=etype==='2'?mapped.label.id:mapped.input.id;
      applyCellStyle(result,source,target,'emaintable',id,targetPos,cell.evalue);
    }
    count++;
  }
  for (const key of Object.keys(tables(result)).filter(x=>/^mc_/.test(x))) delete tables(result)[key];
  for (const key of Object.keys(result.sheetobj||{}).filter(x=>/^mc_/.test(x))) delete result.sheetobj[key];
  return count;
}
async function makeCandidate(source, target) {
  const sourceKind=kind(source),targetKind=kind(target);
  if (sourceKind===targetKind) throw new Error('请选择一份流程节点文件和一份建模文件');
  const result=structuredClone(target), match=matchFields(source,target);
  if (!match.matched.length) throw new Error('两个文件没有可匹配字段');
  const targetAttr=structuredClone(attr(target));
  // Use the source geometry while retaining the target file's envelope and identity.
  result.dataobj.eformdesign.etables=structuredClone(tables(source));
  result.sheetobj=structuredClone(source.sheetobj);
  result.dataobj.eformdesign.eattr=targetAttr;
  const sourcePrefix=sourceKind==='workflow'?'/workflow/exceldesign/image/':'/formmode/exceldesign/image/';
  const targetPrefix=targetKind==='workflow'?'/workflow/exceldesign/image/':'/formmode/exceldesign/image/';
  function replaceImages(value) {
    if (!value || typeof value!=='object') return;
    for (const [key,child] of Object.entries(value)) {
      if (typeof child==='string' && child.startsWith(sourcePrefix)) value[key]=targetPrefix+child.slice(sourcePrefix.length);
      else replaceImages(child);
    }
  }
  replaceImages(result.sheetobj);
  const main=mapTable(result,source,target,'emaintable',mainFields(source),[...mainFields(target),...nestedFields(target)]);
  const nested=flattenNestedWorkflowFields(result,source,target);
  const sourceDetail=detailFields(source),targetDetail=detailFields(target);
  let detail={mapped:0,omitted:0};
  if (tables(source).detail_1 && tables(target).detail_1) detail=mapTable(result,source,target,'detail_1',sourceDetail,targetDetail);
  // The target's native detail sheet and control conventions are retained when
  // both detail layouts put the same named controls in the same cells.
  if (sourceDetail.length===targetDetail.length && sourceDetail.every(f=>targetDetail.some(g=>fieldKey(f)===fieldKey(g)&&f.label.id===g.label.id&&f.input.id===g.input.id))) {
    result.dataobj.eformdesign.etables.detail_1=structuredClone(tables(target).detail_1);
    result.sheetobj.detail_1_sheet=structuredClone(target.sheetobj.detail_1_sheet);
    result.dataobj.eformdesign.etables.detail_1.colheads=structuredClone(tables(source).detail_1.colheads);
  }
  if (sourceKind==='workflow') {
    for (const item of tables(result).emaintable.ec) if (item.etype==='29') { delete item.field; delete item.uuid; item.etype='0'; }
  }
  const finalMain=mainFields(result).length;
  if (finalMain!==main.mapped+nested) throw new Error(`主表字段数量校验失败：${finalMain} != ${main.mapped+nested}`);
  if (String(attr(result).formid)!==String(attr(target).formid)) throw new Error('目标表单 ID 被改变');
  const encoded=await encodeWef(result),readback=await decodeWef(encoded);
  if (JSON.stringify(readback)!==JSON.stringify(result)) throw new Error('WEF 编解码回读校验失败');
  return { result, stats:{ main:finalMain, detail:detailFields(result).length, omittedSource:match.missing.length, unusedTarget:match.extras.length, sourceKind, targetKind } };
}

export { kind, summary, makeCandidate, viewLayout, attr, mainFields, detailFields };
