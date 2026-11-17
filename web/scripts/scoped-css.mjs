/** Prefix imported shared UI styles without changing the Windows/Android CSS. */
export const HOST_ROOT = '#nextglance-root'
export function splitSelectors(value) {
  const result=[];let start=0,depth=0,quote='',escaped=false
  for(let i=0;i<value.length;i++) {
    const c=value[i]
    if(escaped){escaped=false;continue}
    if(c==='\\'){escaped=true;continue}
    if(quote){if(c===quote)quote='';continue}
    if(c==='"'||c==="'"){quote=c;continue}
    if(c==='('||c==='[')depth++
    else if(c===')'||c===']')depth--
    else if(c===','&&depth===0){result.push(value.slice(start,i).trim());start=i+1}
  }
  result.push(value.slice(start).trim());return result
}
export function scopeSelector(selector) {
  if(selector.includes(HOST_ROOT))return selector
  // Shared root/body rules become app-root rules, never host document rules.
  if(/^(?::root|html|body)(?=[\s.#[:>+~]|$)/.test(selector))return selector.replace(/^(?::root|html|body)/,HOST_ROOT)
  return `${HOST_ROOT} ${selector}`
}
export function scopeHostCss() {
  return {postcssPlugin:'nextglance-host-scope',Once(root){
    root.walkAtRules(/keyframes$/i,rule=>{rule.params=`nextglance-${rule.params.replace(/^nextglance-/,'')}`})
    root.walkRules(rule=>{
      for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule'&&/keyframes$/i.test(parent.name))return
      rule.selector=splitSelectors(rule.selector).map(scopeSelector).join(', ')
    })
    root.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/,decl=>{decl.value=decl.value.replace(/\b(?<!nextglance-)spin\b/g,'nextglance-spin')})
  }}
}
