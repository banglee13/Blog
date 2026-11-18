import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';

const storageKey = 'starlog:comments';
function readStore() {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; }
  catch { return {}; }
}
export default function LocalNotes({article}) {
  const getNotes = () => readStore()[article.id] || [];
  const [notes, setNotes] = useState(getNotes);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  function save(next) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({...readStore(), [article.id]:next}));
      setNotes(next); setError(''); return true;
    } catch (err) { setError(err.message); return false; }
  }
  function add(e) {
    e.preventDefault();
    if (!value.trim()) return;
    const item = {id:crypto.randomUUID(), content:value.trim(), postSlug:article.id, createdAt:Date.now(), author:{name:'本机',isLocal:true}};
    if (save([...getNotes(), item])) setValue('');
  }
  return <section className="cr-comments">
    <button className="cr-discussion-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><MessageCircle size={19}/> 我的阅读笔记 · {notes.length}</button>
    {expanded && <div className="cr-thread"><form onSubmit={add}>
      <textarea aria-label="阅读笔记" required value={value} onChange={e=>setValue(e.target.value)} placeholder="只保存在这台设备上"/>
      <button type="submit">保存笔记</button></form>
      {notes.map(n=><div key={n.id} className="cr-comment"><header><time>{new Date(n.createdAt).toLocaleDateString('zh-CN')}</time><button onClick={()=>save(getNotes().filter(item=>item.id!==n.id))}>删除</button></header><p>{n.content}</p></div>)}
      {error && <p role="alert">{error}</p>}</div>}
  </section>;
}
