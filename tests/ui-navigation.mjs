import assert from 'node:assert/strict'

const exactText=value=>new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)

/** Exercise the real navigation drawer; never change planner scope through fixture state. */
export async function openNavigation(page){
  if(!await page.locator('.planner-app').evaluate(element=>element.classList.contains('sidebar-open')))await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  return page.getByRole('complementary',{name:'Navigation',exact:true})
}

export async function selectScope(page,name,{space,kind}={}){
  const navigation=await openNavigation(page)
  if(name==='My overview')await navigation.locator('.sidebar-main').click()
  else{
    const namedSpan=label=>page.locator('span').filter({hasText:exactText(label)})
    const parent=space?navigation.locator('.space-nav-group').filter({has:page.locator('.space-nav').filter({has:namedSpan(space)})}):navigation
    const selector=kind==='space'?'.space-nav':kind==='category'?'.category-nav':kind==='project'?'.project-nav:not(.category-nav):not(.new-project)':'.space-nav,.category-nav,.project-nav:not(.category-nav):not(.new-project)'
    const destination=parent.locator(selector).filter({has:namedSpan(name)})
    assert.equal(await destination.count(),1,`Expected one drawer destination for ${space?`${space} / `:''}${name}`)
    await destination.click()
  }
  await page.getByRole('heading',{name,exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('.planner-app').classList.contains('sidebar-open'))
}
