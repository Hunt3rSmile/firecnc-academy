import {mkdir,copyFile,readdir,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
const {version}=JSON.parse(await readFile('package.json','utf8'));
if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))throw new Error('Invalid release version.');
const mode=process.argv[2];
async function checksum(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function checksums(directory){const files=(await readdir(directory)).filter(name=>name!=='SHA256SUMS.txt').sort();const lines=[];for(const name of files)if((await stat(path.join(directory,name))).isFile())lines.push(`${await checksum(path.join(directory,name))}  ${name}`);await writeFile(path.join(directory,'SHA256SUMS.txt'),lines.join('\n')+'\n');}
if(mode==='checksums') {await checksums(path.resolve(process.argv[3]??'artifacts'));process.exit(0);}
if(!['linux','windows'].includes(mode))throw new Error('Specify linux, windows, or checksums <directory>.');
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!==`v${version}`)throw new Error('Git tag and package version do not match.');
const output=path.resolve('artifacts',mode);await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
const prefix=`FireCNC-Academy-${version}`;
const names=mode==='windows'?[`${prefix}-setup-x64.exe`,`${prefix}-portable-x64.exe`]:[`${prefix}-linux-x64.AppImage`];
for(const name of names){await stat(path.join('release',name));await copyFile(path.join('release',name),path.join(output,name));}
if(mode==='linux') {
  const file=path.join(output,`${prefix}-linux-x64.tar.gz`);
  const processResult=spawn('tar',['--use-compress-program=gzip -1','-cf',file,'-C','release','linux-unpacked'],{stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{processResult.on('error',reject);processResult.on('exit',resolve);});if(code!==0)throw new Error('Could not create Linux archive.');
}
await checksums(output);console.log(`Release assets prepared: ${output}`);
