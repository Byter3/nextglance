import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {packageWeb} from '../scripts/package.mjs'

function fixture() {
  const root=mkdtempSync(path.join(tmpdir(),'nextglance-package-test-'))
  const put=(file,body='fixture')=>{mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),body)}
  put('web/package.json',JSON.stringify({version:'0.6.12'}))
  for(const file of ['LICENSE','NOTICE.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','web/DEPLOYMENT.md','web/appinfo/routes.php','web/lib/Controller.php','web/templates/main.php','web/img/app.svg','packages/core/src/index.mjs','specs/TEST_VECTORS.json','tests/helpers/index.mjs','web/src/main.ts'])put(file)
  put('LICENSES/Apache-2.0.txt','Apache-2.0 license fixture')
  put('NOTICE.md','Artwork origin and modification notice fixture')
  put('web/appinfo/info.xml','<info><id>nextglance</id><version>0.6.12</version><licence>AGPL-3.0-or-later</licence></info>')
  return {root,put,cleanup:()=>rmSync(root,{recursive:true,force:true})}
}

test('packaging refuses missing compiled assets and never calls a build',()=>{
  const f=fixture();let calls=0
  try{assert.throws(()=>packageWeb({root:f.root,run:()=>calls++}),/Missing dist\/js/);assert.equal(calls,0)}finally{f.cleanup()}
})

test('test-only archive layout includes matching source and excludes generated/private paths',()=>{
  const f=fixture()
  try{
    f.put('web/dist/js/nextglance.js','/* fixture, not a production build */');f.put('web/dist/css/nextglance.css','/* fixture */')
    f.put('web/.env.secret','private');f.put('packages/core/node_modules/secret.txt','private');f.put('web/release/old.tar.gz','old')
    f.put('web/.runtime/cache.json','private');f.put('web/app.log','private');f.put('packages/ui/output/private.json','private');f.put('web/local.properties','private')
    const result=packageWeb({root:f.root})
    const list=execFileSync('tar',['-tzf',result.archive],{encoding:'utf8'})
    assert.match(list,/nextglance\/js\/nextglance.js/)
    assert.match(list,/nextglance\/source\/NextGlance-0.6.12-source.tar.gz/)
    assert.doesNotMatch(list,/node_modules|\.env|app\.log|old.tar.gz|\.runtime/)
    const inner=execFileSync('tar',['-xOzf',result.archive,'nextglance/source/NextGlance-0.6.12-source.tar.gz'])
    const innerPath=path.join(f.root,'source.tar.gz');writeFileSync(innerPath,inner)
    const sourceList=execFileSync('tar',['-tzf',innerPath],{encoding:'utf8'})
    assert.match(sourceList,/nextglance-source\/web\/src\/main.ts/)
    assert.match(sourceList,/nextglance-source\/packages\/core\/src\/index.mjs/)
    assert.match(sourceList,/nextglance-source\/tests\/helpers\/index.mjs/)
    for(const file of ['LICENSE','NOTICE.md','LICENSES/Apache-2.0.txt']){
      const expected=readFileSync(path.join(f.root,file))
      assert.deepEqual(execFileSync('tar',['-xOzf',result.archive,`nextglance/${file}`]),expected)
      assert.deepEqual(execFileSync('tar',['-xOzf',innerPath,`nextglance-source/${file}`]),expected)
    }
    assert.doesNotMatch(sourceList,/node_modules|\.env|app\.log|old.tar.gz|\.runtime|\/dist\/|\/output\/|local.properties/)
    assert.match(readFileSync(`${result.archive}.sha256`,'utf8'),new RegExp(`^${result.sha256}  NextGlance-0.6.12-Nextcloud.tar.gz`))
    assert.equal(readdirSync(path.join(f.root,'web/release')).some(name=>name.startsWith('.stage-')),false)
  }finally{f.cleanup()}
})

test('packaging refuses a mismatched app identity or version',()=>{
  const f=fixture()
  try{f.put('web/dist/js/nextglance.js');f.put('web/dist/css/nextglance.css');f.put('web/appinfo/info.xml','<info><id>wrong</id></info>');assert.throws(()=>packageWeb({root:f.root}),/identity, version or license/)}finally{f.cleanup()}
})

test('packaging refuses missing artwork license before archiving',()=>{
  const f=fixture();let calls=0
  try{
    f.put('web/dist/js/nextglance.js');f.put('web/dist/css/nextglance.css')
    rmSync(path.join(f.root,'LICENSES/Apache-2.0.txt'))
    assert.throws(()=>packageWeb({root:f.root,run:()=>calls++}),/Missing required distribution notice: LICENSES\/Apache-2.0.txt/)
    assert.equal(calls,0)
  }finally{f.cleanup()}
})
