import ts from 'typescript';
import fs from 'node:fs';
const source = fs.readFileSync('babylon/cobotMesh.ts','utf8');
const sf=ts.createSourceFile('controller.ts',source,ts.ScriptTarget.Latest,true);
const defs=new Map();
for(const n of sf.statements) {
 const name=n.name?.text ?? (ts.isVariableStatement(n)?n.declarationList.declarations[0].name.getText(sf):undefined);
 if(name) defs.set(name,n);
}
for(const [name,n] of defs) {
 const refs=new Set();
 function walk(node){ if(ts.isIdentifier(node)&&defs.has(node.text)&&node.text!==name)refs.add(node.text);ts.forEachChild(node,walk); }
 walk(n);
 console.log(`${name} (${n.getText(sf).split('\n').length}): ${[...refs].join(', ')}`);
}
