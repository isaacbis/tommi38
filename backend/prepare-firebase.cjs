const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'firebase-public');
const files = ['index.html','success.html','style.css','script.js','community.js','account.js','ads.js','demo-setup.js','app-ads.txt','service-worker.js','manifest.json','privacy.html','support.html','community-rules.html','legal.css','icon-192.png','icon-512.png','icons/apple-touch-icon-v2.png','icons/apple-touch-icon-v3.png'];
fs.mkdirSync(target,{recursive:true});
for(const file of files) {
  const destination=path.join(target,file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(path.join(root,'frontend',file),destination);
}
console.log('Prepared '+files.length+' public Firebase Hosting assets.');
