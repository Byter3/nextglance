import MarkdownIt from 'markdown-it'

const parser=new MarkdownIt({html:false,linkify:true,breaks:true})

/** Positions come from the Markdown block parser, so code examples are never tasks. */
export function markdownTasks(body){
  const source=String(body??''),lines=source.split(/\r\n|\r|\n/),starts=[0]
  for(const match of source.matchAll(/\r\n|\r|\n/g))starts.push(match.index+match[0].length)
  const tokens=parser.parse(source,{}),result=[]
  for(let index=2;index<tokens.length;index++){
    const inline=tokens[index],paragraph=tokens[index-1],item=tokens[index-2]
    if(inline.type!=='inline'||paragraph.type!=='paragraph_open'||item.type!=='list_item_open')continue
    const marker=/^\[([ xX])\](?:\s+|$)/.exec(inline.content)
    if(!marker)continue
    const line=paragraph.map?.[0]??item.map?.[0]
    if(line===undefined)continue
    const physical=/^((?:(?:[ \t]*>[ \t]?)|(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]+))*[ \t]*)\[([ xX])\](?=[ \t]|$)/.exec(lines[line]||'')
    if(!physical||physical[2]!==marker[1])continue
    result.push({line,offset:starts[line]+physical[1].length+1,checked:marker[1].toLowerCase()==='x',text:inline.content.slice(marker[0].length).trim()})
  }
  return result
}

/** Change exactly the checkbox marker character; retain all source syntax and line endings. */
export function toggleMarkdownTask(body,offset){
  const source=String(body??''),task=markdownTasks(source).find(item=>item.offset===offset)
  if(!task)return source
  return source.slice(0,offset)+(task.checked?' ':'x')+source.slice(offset+1)
}

function normalizedTokens(tokens){
  return tokens.map(token=>{
    const type=token.type==='softbreak'?'hardbreak':token.type
    const attrs=(token.attrs||[]).filter(([name,value])=>!(name==='start'&&String(value)==='1')).sort(([a],[b])=>a.localeCompare(b))
    const content=token.children?undefined:token.type==='text'?token.content.replace(/^\[[xX]\](?=\s|$)/,'[x]'):token.content
    return {type,tag:token.tag,nesting:token.nesting,attrs,content,info:token.info||'',children:token.children?normalizedTokens(token.children):undefined}
  })
}

/** A conservative guard: fall back to source when rich editing could discard meaning. */
export function markdownVisualIssue(body){
  const source=String(body??''),env={},tokens=parser.parse(source,env)
  if(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(source))return 'This description contains front matter. Use Markdown source to preserve it.'
  if(env.references&&Object.keys(env.references).length)return 'This description uses reference links. Use Markdown source to preserve their definitions.'
  const visit=items=>{
    for(const token of items){
      if(token.type==='image')return 'This description contains an image. Use Markdown source to preserve its reference.'
      if(token.type==='text'&&(/<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s|\/?>)/.test(token.content)||/<!--/.test(token.content)))return 'This description contains HTML or custom tags. Use Markdown source to preserve them.'
      if(token.type==='text'&&/\[\^[^\]]+\]|^:::[\w-]|\$\$/.test(token.content))return 'This description uses custom Markdown syntax. Use Markdown source to preserve it.'
      if(token.children){const issue=visit(token.children);if(issue)return issue}
    }
    return ''
  }
  return visit(tokens)
}

export function markdownEquivalent(first,second){
  return JSON.stringify(normalizedTokens(parser.parse(String(first??''),{})))===JSON.stringify(normalizedTokens(parser.parse(String(second??''),{})))
}
