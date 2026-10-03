'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]||'.');
if(!fs.existsSync(path.join(root,'.nojekyll')))throw Error('Expected a separate public checkout with .nojekyll');
const domain=fs.readFileSync(path.join(root,'CNAME'),'utf8').trim().toLowerCase();
if(!/^(?:www\.)?hudwagen\.ru$/.test(domain))throw Error('Unexpected CNAME: verify the production domain before generating');
const base=`https://${domain}/`;
const yandexFile=path.join(root,'yandex_6e27c15c6abee37a.html');
if(!fs.existsSync(yandexFile)||!fs.readFileSync(yandexFile,'utf8').includes('Verification: 6e27c15c6abee37a'))throw Error('Missing published Yandex Webmaster verification file');
const currentRoot=fs.readFileSync(path.join(root,'index.html'),'utf8');
const verificationTags=[...currentRoot.matchAll(/<meta name="(?:google-site-verification|msvalidate\.01)" content="[^"]+">/g)].map(match=>match[0]);
if(verificationTags.length!==2||!verificationTags.some(tag=>tag.includes('google-site-verification'))||!verificationTags.some(tag=>tag.includes('msvalidate.01')))throw Error('Missing published Google/Bing verification meta tags');
let html=fs.readFileSync(path.join(root,'site-final/index.html'),'utf8');
html=html.replaceAll('../concepts/shared/','concepts/shared/').replaceAll('"assets/','"site-final/assets/').replaceAll('../assets/privacy-notice.','assets/privacy-notice.').replaceAll('../site-final/privacy.html','site-final/privacy.html').replaceAll(', assets/',', site-final/assets/').replace('href="site.css"','href="site-final/site.css"').replace('src="site.js"','src="site-final/site.js"').replace('src="consent-metrika.js','src="site-final/consent-metrika.js').replace('noindex, nofollow','index, follow');
const title=html.match(/<title>([^<]+)<\/title>/)?.[1];
const description=html.match(/<meta name="description" content="([^"]+)">/)?.[1];
if(!title||!description)throw Error('Missing homepage metadata');
const service={
  '@context':'https://schema.org',
  '@type':'Service',
  '@id':`${base}#service`,
  name:'Худваген с водителем для съёмок',
  serviceType:'Худваген с водителем для художественного цеха',
  description:'Худваген с водителем, доставка реквизита и материалов и рабочая база на съёмочной площадке. Москва и Московская область; другие регионы по договорённости.',
  url:base,
  provider:{'@type':'Person',name:'Марат',telephone:'+79636981001'},
  areaServed:[{'@type':'City',name:'Москва'},{'@type':'AdministrativeArea',name:'Московская область'}]
};
const structuredData=JSON.stringify(service).replaceAll('<','\\u003c');
html=html.replace('</head>',`${verificationTags.join('')}<link rel="canonical" href="${base}"><meta property="og:type" content="website"><meta property="og:locale" content="ru_RU"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${base}"><meta property="og:image" content="${base}site-final/assets/van-city-1280.webp"><script type="application/ld+json">${structuredData}</script></head>`);
fs.writeFileSync(path.join(root,'index.html'),html);
fs.writeFileSync(path.join(root,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n`);
fs.writeFileSync(path.join(root,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}</loc></url></urlset>\n`);
