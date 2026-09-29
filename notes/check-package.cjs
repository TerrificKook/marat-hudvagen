'use strict';
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const pages=['concepts/index.html','concepts/concept-a/index.html','concepts/concept-b/index.html','concepts/concept-c/index.html','site-final/index.html','site-final/brief.html','site-final/privacy.html'];
if(fs.existsSync(path.join(root,'.nojekyll')))pages.push('index.html');
const issues=[];let resources=0;
const maxUrl='https://max.ru/u/f9LHodD0cOJyWwkVK0IOzBzi9cnYJhqR4KUHkZVEpKO9ZInxwAOQDD3dlvk';
function target(from,value){
 if(!value||/^(https?:|tel:|mailto:|data:)/.test(value))return;
 const [file,hash]=value.split('#');
 const dest=file?path.resolve(path.dirname(path.join(root,from)),decodeURI(file.split('?')[0])):path.join(root,from);
 let actual=dest;
 if(!actual.startsWith(root+path.sep)&&actual!==root){issues.push(`${from}: outside package ${value}`);return;}
 if(fs.existsSync(actual)&&fs.statSync(actual).isDirectory())actual=path.join(actual,'index.html');
 if(!fs.existsSync(actual)){issues.push(`${from}: missing ${value}`);return;}
 resources++;
 if(hash&&path.extname(actual)==='.html'){
  const html=fs.readFileSync(actual,'utf8');
  if(!html.includes(`id="${hash}"`)&&!html.includes(`id='${hash}'`))issues.push(`${from}: missing anchor ${value}`);
 }
}
for(const page of pages){
 const html=fs.readFileSync(path.join(root,page),'utf8');
 if((html.match(/<h1\b/g)||[]).length!==1)issues.push(`${page}: H1 count`);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 if(new Set(ids).size!==ids.length)issues.push(`${page}: duplicate IDs`);
 if(page==='index.html'?!/name="robots" content="index, follow/.test(html):!/name="robots" content="noindex/.test(html))issues.push(`${page}: missing noindex`);
 if(/\b(?:2019|2009)\b/.test(html))issues.push(`${page}: vehicle year should be omitted`);
 if(/Контакт уточняется|контакт Марата пока уточняется|TODO/.test(html))issues.push(`${page}: stale placeholder`);
 if(!['concepts/index.html','site-final/privacy.html'].includes(page)){
  if(/13 000|1 300/.test(html))issues.push(`${page}: outdated tariff`);
  for(const amount of ['14 000','1 400','65 ₽'])if(!html.includes(amount))issues.push(`${page}: missing tariff ${amount}`);
 }
 if(!['concepts/index.html'].includes(page)&&!html.includes(`href="${maxUrl}"`))issues.push(`${page}: missing direct MAX contact`);
 if(/web\.max\.ru|data-max|max-dialog|max-fallback/.test(html))issues.push(`${page}: stale MAX fallback`);
 if(/<form\b|<textarea\b|<input\b|<select\b/.test(html))issues.push(`${page}: unexpected input form`);
 if(['index.html','concepts/concept-c/index.html','site-final/index.html','site-final/brief.html'].includes(page)){
  const header=html.match(/<header\b[\s\S]*?<\/header>/)?.[0]||'';
  const sections=page==='site-final/brief.html'?['#van','#rates']:['#real','#terms'];
  for(const href of [...sections,maxUrl,'https://t.me/+79636981001','tel:+79636981001']){
   if(!header.includes(`href="${href}"`))issues.push(`${page}: missing header link ${href}`);
  }
 }
 for(const m of html.matchAll(/(?:href|src)="([^"]*)"/g))target(page,m[1]);
 for(const m of html.matchAll(/srcset="([^"]*)"/g))for(const image of m[1].split(','))target(page,image.trim().split(/\s/)[0]);
}
for(const file of ['concepts/shared/experience.css','site-final/style.css','site-final/site.css','assets/privacy-notice.css']){
 const css=fs.readFileSync(path.join(root,file),'utf8');
 for(const m of css.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g))target(file,m[1]);
}
for(const file of ['concepts/shared/experience.js','concepts/shared/van-3d.js','site-final/main.js','site-final/site.js','assets/privacy-notice.js','serve-local.js']){
 try{execFileSync(process.execPath,['--check',path.join(root,file)]);}catch{issues.push(`${file}: syntax`);}
}
console.log(JSON.stringify({pages:pages.length,localReferences:resources,issues,ok:!issues.length},null,2));
process.exitCode=issues.length?1:0;
