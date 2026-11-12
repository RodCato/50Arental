// Exercise the real disclosure before selecting an existing section button.
export async function navigateTo(page, selector){
 const section=page.locator(selector);
 if(!await section.isVisible())await page.getByRole('button',{name:'Main navigation',exact:true}).click();
 await section.click();
}
