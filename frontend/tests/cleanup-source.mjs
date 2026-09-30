import fs from 'node:fs';
import ts from 'typescript';
const remove = {
 'babylon/cobot/controller.ts': ['shoulderLimits','elbowLimits','wristLimits'],
 'babylon/cobot/motion.ts': ['shoulderLimits','elbowLimits','wristLimits','isActuallyMoving'],
 'babylon/cobot/pickup.ts': ['hoverTime'],
 'babylon/cobot/program.ts': ['hasPickFilter'],
 'components/BabylonScene.tsx': ['COBOT_PLATFORM_CENTER_Y','isOnOtherCobot','getGridMap'],
 'components/UI.tsx': ['moduleConfigTypes','patchSelectedPosition','patchMachineSize','patchMachineHeight'],
 'vite.config.ts': ['env'],
};
for(const [path,names] of Object.entries(remove)) {
 let s=fs.readFileSync(path,'utf8');
 const sf=ts.createSourceFile(path,s,ts.ScriptTarget.Latest,true);
 const edits=[];
 function visit(n) {
   if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&names.includes(n.declarationList.declarations[0].name.getText(sf))) edits.push([n.getFullStart(),n.end]);
   else if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)) edits.push([n.getFullStart(),n.end]);
   else ts.forEachChild(n,visit);
 }
 visit(sf);
 for(const [start,end] of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,start)+s.slice(end);
 fs.writeFileSync(path,s);
}
// Remove helper exports with no remaining consumers in application code or tests.
const allFiles=[];
function collect(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','.git'].includes(e.name))continue;const p=dir+'/'+e.name;if(e.isDirectory())collect(p);else if(/\.(ts|tsx|mjs)$/.test(p)&&!p.includes('tests/analyze-')&&!p.includes('tests/split-')&&!p.includes('tests/clean-')&&!p.includes('tests/extract-')&&!p.includes('tests/update-')&&!p.includes('tests/cleanup-'))allFiles.push(p);}}
collect('.');
let deleted=true;
while(deleted){deleted=false;const allText=allFiles.map(p=>fs.readFileSync(p,'utf8')).join('\n');
 for(const path of allFiles.filter(p=>/babylon\/cobot\/(geometry|planner|dropTargets|contactConstants)\.ts$/.test(p))){
  let s=fs.readFileSync(path,'utf8'); const sf=ts.createSourceFile(path,s,ts.ScriptTarget.Latest,true);const edits=[];
  for(const n of sf.statements){const name=n.name?.text??(ts.isVariableStatement(n)?n.declarationList.declarations[0].name.getText(sf):null);if(name&&(allText.match(new RegExp('\\b'+name+'\\b','g'))??[]).length===1){edits.push([n.getFullStart(),n.end]);console.log('Removed unused helper',name);}}
  for(const [a,b]of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+s.slice(b);
  if(edits.length){deleted=true;fs.writeFileSync(path,s);}
 }
}
const configPath=ts.findConfigFile('.',ts.sys.fileExists,'tsconfig.json');
const config=ts.parseJsonConfigFileContent(ts.readConfigFile(configPath,ts.sys.readFile).config,ts.sys,'.');
const host={getScriptFileNames:()=>config.fileNames,getScriptVersion:()=> '0',getScriptSnapshot:p=>fs.existsSync(p)?ts.ScriptSnapshot.fromString(fs.readFileSync(p,'utf8')):undefined,getCurrentDirectory:()=>process.cwd(),getCompilationSettings:()=>config.options,getDefaultLibFileName:o=>ts.getDefaultLibFilePath(o),fileExists:ts.sys.fileExists,readFile:ts.sys.readFile,readDirectory:ts.sys.readDirectory};
const service=ts.createLanguageService(host);
for(const path of config.fileNames.filter(p=>/\.(ts|tsx)$/.test(p))) {
 let s=fs.readFileSync(path,'utf8');
 const changes=service.organizeImports({type:'file',fileName:path},{},{})[0]?.textChanges??[];
 for(const {span,newText} of changes.sort((a,b)=>b.span.start-a.span.start))s=s.slice(0,span.start)+newText+s.slice(span.start+span.length);
 fs.writeFileSync(path,s);
}
