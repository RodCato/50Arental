import assert from 'node:assert/strict';
export async function checkSettingsDisclosure(page,{cloud=false}={}) {
  await page.locator('[data-tab="settings"]').click();
  const tools=page.locator('#legacyRecoveryTools'),summary=tools.locator('summary');
  assert.equal(await tools.getAttribute('open'),null,'Collapsed on page load');
  assert.equal(await page.locator('#exportBtn').isVisible(),false);
  assert.equal(await page.locator('#cloudFoundation').isVisible(),true);
  assert.ok((await summary.boundingBox()).height>=44);
  await summary.click();
  for(const id of ['exportBtn','googleClientIdInput','connectGoogleBtn','syncNowBtn','restoreGoogleBtn','disconnectGoogleBtn'])assert.equal(await page.locator('#'+id).isVisible(),true,id);
  assert.equal(await page.locator('#exportBtn').isEnabled(),true);
  assert.equal(await page.locator('#importInput').isDisabled(),cloud);
  assert.equal(await page.locator('#connectGoogleBtn').isDisabled(),cloud);
  if(cloud)for(const id of ['syncNowBtn','restoreGoogleBtn','disconnectGoogleBtn'])assert.equal(await page.locator('#'+id).isDisabled(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
  if(page.viewportSize().width===390)for(const id of ['exportBtn','connectGoogleBtn','syncNowBtn','restoreGoogleBtn','disconnectGoogleBtn'])assert.ok((await page.locator('#'+id).boundingBox()).height>=44);
  await summary.focus();await summary.press('Enter');assert.equal(await tools.getAttribute('open'),null);
  await summary.press('Space');assert.notEqual(await tools.getAttribute('open'),null);
  console.log(`PASS: ${page.viewportSize().width}px ${cloud?'cloud':'local'} disclosure, keyboard/touch sizing, visibility and preserved control availability`);
}
