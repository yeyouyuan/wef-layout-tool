import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['public/app.js'],bundle:true,format:'esm',platform:'browser',outfile:'dist/app.js',minify:true,legalComments:'none'});
await cp('public/index.html','dist/index.html');
await cp('public/styles.css','dist/styles.css');
await writeFile('dist/.nojekyll','');
