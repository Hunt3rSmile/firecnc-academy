export function redactDiagnostics(value:unknown,depth=0):unknown {
  if(depth>6)return '[ограничено]';
  if(typeof value==='string')return value.includes('PRIVATE KEY')?'[скрыто]':value.replace(/FCNC1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[лицензия скрыта]').replace(/FCNC(?:[-\s]*[A-Z0-9]){32}/gi,'[ключ скрыт]').slice(0,1000);
  if(Array.isArray(value))return value.slice(0,100).map(v=>redactDiagnostics(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,50).map(([key,v])=>[key,/token|password|secret|private|installationId|installationHash|licensedTo|customer|email|path/i.test(key)?'[скрыто]':redactDiagnostics(v,depth+1)]));
  return value;
}
