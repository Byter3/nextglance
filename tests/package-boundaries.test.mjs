import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, readdir} from 'node:fs/promises'
import path from 'node:path'
import {builtinModules} from 'node:module'
import ts from 'typescript'

const root=path.resolve(import.meta.dirname,'..')
const builtins=new Set(builtinModules.flatMap(name=>[name,name.replace(/^node:/,''),`node:${name.replace(/^node:/,'')}`]))
// Client-local tests intentionally consume root test helpers and shared vectors.
// Production src/electron trees remain fully subject to package boundaries.
const ignored=new Set(['node_modules','dist','build','.gradle','.idea','.git','tests'])
const clients=[{directory:'win',name:'windows'},{directory:'android',name:'android'},{directory:'web',name:'nextcloud'}]
const isInside=(parent,target)=>{const relative=path.relative(parent,target);return relative===''||!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative)}

async function workspacePackages(){
  const result=[]
  const directories=clients.map(client=>path.join(root,client.directory))
  for(const entry of await readdir(path.join(root,'packages'),{withFileTypes:true}))if(entry.isDirectory())directories.push(path.join(root,'packages',entry.name))
  for(const directoryPath of directories){
    const manifest=JSON.parse(await readFile(path.join(directoryPath,'package.json'),'utf8'))
    result.push({directory:directoryPath,manifest})
  }
  return result
}
async function sources(directory){
  const result=[]
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(ignored.has(entry.name))continue
    const filename=path.join(directory,entry.name)
    if(entry.isDirectory())result.push(...await sources(filename))
    else if(/\.(?:[cm]?[jt]s|tsx|vue)$/.test(entry.name))result.push(filename)
  }
  return result
}
function analyze(filename,body){
  const script=filename.endsWith('.vue')?[...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n'):body
  const ast=ts.createSourceFile(filename,script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
  const imports=[],identifiers=new Set()
  const visit=node=>{
    if(ts.isIdentifier(node))identifiers.add(node.text)
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))imports.push(node.moduleSpecifier.text)
    if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))imports.push(node.arguments[0].text)
    ts.forEachChild(node,visit)
  }
  visit(ast)
  return {imports,identifiers}
}

test('shared planning, contracts and Nextcloud protocol cannot acquire Node runtime dependencies',async()=>{
  const violations=[]
  for(const packageName of ['core','contracts','nextcloud'])for(const filename of await sources(path.join(root,'packages',packageName,'src'))){
    const analysis=analyze(filename,await readFile(filename,'utf8'))
    const label=path.relative(root,filename)
    for(const specifier of analysis.imports)if(builtins.has(specifier)||specifier.startsWith('node:')||specifier.startsWith('@nextspace/nextcloud-node'))violations.push(`${label}: ${specifier}`)
    if(analysis.identifiers.has('Buffer'))violations.push(`${label}: Node Buffer`)
  }
  assert.deepEqual(violations,[],'Shared planning must run on Android/browser without Node shims')
})

test('workspace sources use declared package contracts instead of reaching into sibling folders',async()=>{
  const violations=[]
  for(const workspace of await workspacePackages()){
    const declared={...workspace.manifest.dependencies,...workspace.manifest.devDependencies,...workspace.manifest.peerDependencies}
    for(const filename of await sources(workspace.directory))for(const specifier of analyze(filename,await readFile(filename,'utf8')).imports){
      const label=path.relative(root,filename)
      if(specifier.startsWith('.')&&!isInside(workspace.directory,path.resolve(path.dirname(filename),specifier)))violations.push(`${label}: relative import leaves its package (${specifier})`)
      if(specifier.startsWith('@nextspace/')){
        const dependency=specifier.split('/').slice(0,2).join('/')
        if(dependency!==workspace.manifest.name&&!declared[dependency])violations.push(`${label}: undeclared dependency ${dependency}`)
      }
      if(workspace.manifest.name==='@nextspace/ui'&&(builtins.has(specifier)||specifier.startsWith('node:')||specifier.startsWith('@nextspace/nextcloud-node')))violations.push(`${label}: platform backend leaked into UI (${specifier})`)
    }
  }
  assert.deepEqual(violations,[],'Each client/package must retain explicit dependencies when separated into repositories')
})

test('Windows, Android and Nextcloud clients have separate private package identities',async()=>{
  const packages=await workspacePackages()
  const names=packages.map(item=>item.manifest.name)
  assert.equal(new Set(names).size,names.length,'Workspace package names must be unique')
  for(const client of clients){
    const workspace=packages.find(item=>item.directory===path.join(root,client.directory))
    assert.ok(workspace,`${client.directory} client directory and manifest must exist`)
    assert.equal(workspace.manifest.name,`@nextspace/${client.name}`)
    assert.equal(workspace.manifest.private,true,'No client should become publishable as part of this restructuring')
  }
})
