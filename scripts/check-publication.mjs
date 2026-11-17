import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const blocked=[];
for(const file of new Set(files)) {
  const normalized=file.replaceAll('\\','/');
  if(/(^|\/)(?:\.local|private-keys[^/]*|issued[^/]*|node_modules|release|artifacts)(\/|$)/.test(normalized)||/\.(?:pem|key|p12|pfx|fcnclic|sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?)$/i.test(normalized)||/(^|\/)\.env(?:\.|$)/.test(normalized)&&!normalized.endsWith('.env.example')){blocked.push(file);continue;}
  const bytes=await readFile(file);if(bytes.includes(0))continue;
  const text=bytes.toString('utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text))blocked.push(file);
  if(/(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,}/.test(text))blocked.push(file);
  if(/\bsk-[a-f0-9]{32,64}\b/i.test(text))blocked.push(file);
  if(/FCNC1\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{70,}/.test(text)&&normalized!=='tests/fixtures/public-license-vector.json')blocked.push(file);
}
if(blocked.length)throw new Error('Publication blocked: '+[...new Set(blocked)].join(', '));
console.log(`Publication inventory checked: ${new Set(files).size} files, no private keys, real licenses, databases, or access tokens.`);
