import { decodeWef, encodeWef, kind, summary, makeCandidate, viewLayout, attr, mainFields, detailFields } from './core.js';
const $=id=>document.getElementById(id);
let bundle=null, direction='workflow-to-model', activeTab='matches', candidate=null;
$('files').addEventListener('change',()=>{
 const files=[...$('files').files];
 $('files-name').textContent=files.length===2?files.map(f=>f.name).join('  +  '):files.length?`已选择 ${files.length} 份文件，请一次选择恰好两份`:'选择两份文件';
 bundle=null;$('results').hidden=true;
 if(files.length===2)$('analyze').click();
 else if(files.length)status('请在同一次选择中选中恰好两份文件。',true);
});
function current(){return bundle?.directions?.[direction];}
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function el(tag,text,className){const n=document.createElement(tag);if(text!=null)n.textContent=String(text);if(className)n.className=className;return n;}
function stat(value,label){const n=el('div',null,'stat');n.append(el('b',value),el('span',label));return n;}
function renderGrid(container,layout){
 container.replaceChildren();if(!layout)return;
 const grid=el('div',null,'sheet-grid'),rows=Math.min(layout.rows,80),cols=Math.min(layout.cols,12);
 grid.style.gridTemplateColumns=`repeat(${cols}, minmax(74px, 1fr))`;
 const map=new Map(layout.cells.map(c=>[c.id,c])),covered=new Set();
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
  const key=`${r},${c}`;if(covered.has(key))continue;
  const item=map.get(key),cell=el('div',item?.text||'','sheet-cell');
  if(item){
   const nc=Math.min(item.colspan||1,cols-c),nr=Math.min(item.rowspan||1,rows-r);
   if(nc>1)cell.style.gridColumn=`span ${nc}`;if(nr>1)cell.style.gridRow=`span ${nr}`;
   for(let rr=r;rr<r+nr;rr++)for(let cc=c;cc<c+nc;cc++)if(rr!==r||cc!==c)covered.add(`${rr},${cc}`);
   if(item.type==='2')cell.classList.add('label');else if(item.type==='3')cell.classList.add('input');else if(item.type==='7')cell.classList.add('detail');else if(item.text)cell.classList.add('heading');
   if(item.field)cell.title=`${item.text}\n字段 ID: ${item.field}\n单元格: ${key}`;
  }else cell.classList.add('ghost');grid.append(cell);
 }
 container.append(grid);
}
function renderTable(){
 const a=current(),area=$('table-area');area.replaceChildren();if(!a)return;
 const data=a[activeTab==='matches'?'matched':activeTab],table=el('table'),head=el('thead'),body=el('tbody');
 const columns=activeTab==='matches'?['字段名','类型','来源字段 ID','目标字段 ID','来源位置','目标位置']:['字段名','类型','字段 ID','标签位置'];
 const hr=el('tr');for(const c of columns)hr.append(el('th',c));head.append(hr);
 for(const item of data){const f=item.source||item,row=el('tr');const values=activeTab==='matches'?[f.name,f.type,f.id,item.target.id,item.nested?'合并单元格':f.label,item.target.label]:[f.name,f.type,f.id,f.label];for(const v of values)row.append(el('td',v));body.append(row);}
 table.append(head,body);area.append(table);if(!data.length)area.replaceChildren(el('p','没有此类字段。','hint'));
}
function render(){
 const a=current();if(!a)return;
 const sourceName=a.source.kind==='workflow'?'流程节点':'建模表单',targetName=a.target.kind==='workflow'?'流程节点':'建模表单';
 $('identity').textContent=`来源：${sourceName}（${a.source.attr.formid}） · 目标：${targetName}（${a.target.attr.formid}）`;
 $('stats').replaceChildren(stat(a.source.main+a.source.nested,'来源主表字段'),stat(a.target.main+a.target.nested,'目标主表字段'),stat(a.matched.length,'已匹配字段'),stat(a.missing.length,'来源未匹配'));
 $('warning').textContent=a.missing.length?`来源布局有 ${a.missing.length} 个字段未在目标表单匹配到。生成时将省略这些控件，需主动确认。`:`${a.matched.length} 个来源字段已匹配；目标表单另有 ${a.extras.length} 个字段不会出现在转换后的布局中。`;
 $('source-title').textContent=`来源：${sourceName}`;$('target-title').textContent=`目标：${targetName}`;
 renderGrid($('source-grid'),a.source.layout);renderGrid($('target-grid'),a.target.layout);
 $('match-count').textContent=a.matched.length;$('extra-count').textContent=a.extras.length;$('missing-count').textContent=a.missing.length;
 $('omit-wrap').hidden=!a.requiresOmit;$('omit-label').textContent=`我已核对并接受省略 ${a.missing.length} 个未匹配的来源字段控件。`;
 $('allow-omit').checked=false;$('generate').disabled=!a.canGenerate||a.requiresOmit;
 $('download-wef').hidden=true;$('download-json').hidden=true;$('generated').hidden=true;
 candidate=null;
 renderTable();
}
$('allow-omit').addEventListener('change',()=>{$('generate').disabled=!current()?.canGenerate||(current()?.requiresOmit&&!$('allow-omit').checked);});
document.querySelectorAll('.direction-btn').forEach(b=>b.addEventListener('click',()=>{
 direction=b.dataset.direction;document.querySelectorAll('.direction-btn').forEach(x=>x.classList.toggle('active',x===b));render();status('已切换转换方向。');
}));
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
 activeTab=b.dataset.tab;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));renderTable();
}));
$('analyze').addEventListener('click',async()=>{
 const files=[...$('files').files];
 if(files.length!==2){status('请一次选择恰好两份文件。',true);return;}
 const button=$('analyze');button.disabled=true;status('正在解码和识别文件…');
 try{
  const first=await decodeWef(await files[0].text()),second=await decodeWef(await files[1].text());
  const firstKind=kind(first),secondKind=kind(second);
  if(firstKind===secondKind)throw Error('需要一份流程节点布局和一份建模布局；当前两份类型相同');
  const workflow=firstKind==='workflow'?first:second,model=firstKind==='model'?first:second;
  bundle={workflow,model,directions:{'workflow-to-model':summary(workflow,model),'model-to-workflow':summary(model,workflow)}};
  direction='workflow-to-model';document.querySelectorAll('.direction-btn').forEach(x=>x.classList.toggle('active',x.dataset.direction===direction));
  $('results').hidden=false;render();status(`识别成功：第一份是${firstKind==='workflow'?'流程节点':'建模表单'}布局，第二份是${secondKind==='workflow'?'流程节点':'建模表单'}布局。文件只在本机浏览器处理。`);
 }catch(error){status(error.message,true);}finally{button.disabled=false;}
});
$('generate').addEventListener('click',async()=>{
 if(!bundle)return;const button=$('generate');button.disabled=true;status('正在生成并回读校验候选文件…');
 try{
  const check=current();
  if(check.detailMissing.length)throw Error('明细字段未完全匹配，暂不能生成');
  if(check.missing.length&&!$('allow-omit').checked)throw Error('请确认省略未匹配字段');
  const source=direction==='workflow-to-model'?bundle.workflow:bundle.model;
  const target=direction==='workflow-to-model'?bundle.model:bundle.workflow;
  const built=await makeCandidate(source,target);
  candidate=built.result;
  for(const id of ['download-wef','download-json']){const a=$(id);if(a.dataset.url)URL.revokeObjectURL(a.dataset.url);}
  const wef=await encodeWef(candidate),json=JSON.stringify(candidate,null,2);
  const wefUrl=URL.createObjectURL(new Blob([wef],{type:'text/plain'}));
  const jsonUrl=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  $('download-wef').href=wefUrl;$('download-wef').dataset.url=wefUrl;
  $('download-json').href=jsonUrl;$('download-json').dataset.url=jsonUrl;
  $('download-wef').download=`e9-${direction}-candidate.wef`;
  $('download-json').download=`e9-${direction}-candidate.json`;
  $('download-wef').hidden=false;$('download-json').hidden=false;
  $('generated').textContent=`已生成 ${built.stats.targetKind==='workflow'?'流程节点':'建模表单'}候选布局：主表 ${built.stats.main} 个字段，明细表 ${built.stats.detail} 个字段，表单 ID ${attr(candidate).formid}。省略来源字段 ${built.stats.omittedSource} 个。`;
  $('generated').hidden=false;status('候选文件已生成，通过本地解密回读校验。');
 }catch(error){status(error.message,true);}finally{button.disabled=!current()?.canGenerate||(current()?.requiresOmit&&!$('allow-omit').checked);}
});
