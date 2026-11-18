import { hiddenSeedSlugs, restoreSeedPost, hideSeedPost, listLocalVersions, pushLocalVersion } from '../src/lib/offlineLibrary';
import { getLocalPosts, deleteLocalPost, saveLocalPostRaw, serializePost, today } from '../src/lib/posts';
import { describeBackend, exportLocalRecords, flushStorage, importLocalRecords } from '../src/lib/offlineStorage';
import { getArticles, publishedSource } from './content.js';
import { command, download, escapeHTML as h, tool } from './ui.js';

export async function publishOfflineDraft(id, password) {
  const draft=getLocalPosts().find(p=>p.slug===id);
  if (!draft?.content.trim()) throw new Error('请先填写文章正文。');
  if ((draft.encryptIntent || publishedSource(id)?.encryption) && !password) throw new Error('请设置密码以加密保存。');
  const post = {...draft, draft:false, updated:today()};
  const raw = password ? await (await import('../src/lib/crypto')).encryptPostMarkdown(post,password) : serializePost(post);
  saveLocalPostRaw(id,raw);
  pushLocalVersion(id,raw,'保存到本机文章库');
  await flushStorage();
}
const localKeys = new Set(['starlog:drafts','starlog:offline-hidden','starlog:offline-versions','starlog:comments','starlog:update-queue','starlog:offline-echoes']);
function exportable(records) {
  return Object.fromEntries(Object.entries(records).filter(([key,value])=>localKeys.has(key) && typeof value==='string'));
}
export function offlineAccount(body, {listen, open}) {
  body.innerHTML='<section class="p-section"><h3>本机文章库</h3><p class="fine">文章、阅读笔记和草稿保存在本机。当前存储方式为 '+h(describeBackend())+'。</p></section><div class="actions">'+command('library','Library','内容管理')+'</div>';
  listen(body.querySelector('button'),'click',()=>open('manage'));
}
export function offlineManager(body, ctx) {
  const {listen,msg,open} = ctx;
  const drafts = getLocalPosts().filter(p=>p.draft);
  const published = getArticles();
  const hidden = hiddenSeedSlugs();
  function row(id,title,isDraft) {
    return '<div class="library-entry" data-id="'+h(id)+'"><strong>'+h(title)+'</strong><div>'+
      (!isDraft?tool('read','BookOpen','阅读文章')+tool('history','List','本机历史'):'')+
      tool('edit','PencilLine','编辑文章')+(isDraft?tool('discard','Trash2','删除草稿'):tool('hide','X','移出本机星图'))+'</div></div>';
  }
  body.innerHTML='<div class="actions">'+command('new','Plus','写新文章','primary')+command('backup','Download','备份本机档案')+command('import','Upload','恢复备份')+'</div><input hidden type="file" accept=".json"><div class="lib-extra" aria-live="polite"></div>'+
    '<section class="p-section"><h3>本机草稿 · '+drafts.length+'</h3>'+drafts.map(p=>row(p.slug,p.title,true)).join('')+'</section>'+
    '<section class="p-section"><h3>星图中的文章 · '+published.length+'</h3>'+published.map(a=>row(a.id,a.title,false)).join('')+'</section>'+
    (hidden.length?'<section class="p-section"><h3>已隐藏</h3>'+hidden.map(id=>'<div class="inline-row" data-id="'+h(id)+'"><span>'+h(id)+'</span>'+command('restore','RotateCcw','恢复到星图')+'</div>').join('')+'</section>':'');
  const importFile=body.querySelector('[type=file]'),extra=body.querySelector('.lib-extra');
  const reenter=()=>open('manage');
  let pendingImport;
  listen(importFile,'change',async()=>{
    try{
      const file=importFile.files[0];if(!file)return;
      const archive=JSON.parse(await file.text());
      if(archive.format!=='starlog-local-archive'||archive.version!==1||!archive.records)throw Error('请选择本机档案备份文件。');
      pendingImport=exportable(archive.records);
      if(!Object.keys(pendingImport).length)throw Error('备份中没有文章、笔记或历史记录。');
      extra.innerHTML='<p class="fine">恢复将替换备份中包含的本机数据。</p>'+command('confirm-import','Upload','确认恢复');
    }catch(err){msg(err.message)}finally{importFile.value=''}
  });
  let pendingRemoval;
  listen(body,'click',async e=>{
    const b=e.target.closest('[data-action]');if(!b)return;
    const id=b.closest('[data-id]')?.dataset.id;
    try {
      switch(b.dataset.action) {
        case 'new':open('editor');return;
        case 'edit':open('editor',{id});return;
        case 'read':ctx.goArticle(published.find(a=>a.id===id));return;
        case 'backup':{
          const records=exportable(exportLocalRecords());
          if(!Object.keys(records).length){msg('当前还没有本机数据。');return}
          download('starlog-'+today()+'.json',JSON.stringify({format:'starlog-local-archive',version:1,records}),'application/json');
          return;
        }
        case 'import':importFile.click();return;
        case 'confirm-import':await importLocalRecords(pendingImport);reenter();return;
        case 'restore':restoreSeedPost(id);reenter();return;
        case 'history':{
          const versions=listLocalVersions(id);
          extra.innerHTML=versions.length?versions.map((v,i)=>'<div class="inline-row"><span>'+h(v.message)+' · '+h(new Date(v.savedAt).toLocaleString())+'</span><button class="command" data-version="'+i+'">导出此版</button></div>').join(''):'<p class="fine">这篇文章尚无本机历史。</p>';
          extra.querySelectorAll('[data-version]').forEach(btn=>listen(btn,'click',()=>{const item=versions[Number(btn.dataset.version)];download(id+'-'+item.id+'.md',item.raw,'text/markdown')}));
          return;
        }
        case 'hide':case 'discard':
          pendingRemoval={id,hide:b.dataset.action==='hide'};
          extra.innerHTML=command('confirm-remove','Trash2',pendingRemoval.hide?'确认移出本机星图':'确认删除草稿')+command('cancel-remove','X','取消');
          extra.scrollIntoView({block:'nearest'});return;
        case 'cancel-remove':extra.replaceChildren();pendingRemoval=null;return;
        case 'confirm-remove':{
          if(!pendingRemoval)return;
          const item=pendingRemoval;
          if(item.hide&&publishedSource(item.id))hideSeedPost(item.id);
          if(getLocalPosts().some(p=>p.slug===item.id))deleteLocalPost(item.id);
          reenter();return;
        }
      }
    }catch(err){msg(err.message)}
  });
}

