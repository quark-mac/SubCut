import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function fixture(page: Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, `tracks-${Date.now()}.jsonl`);
  await fs.writeFile(subtitle, ['甲', '乙', '丙'].map((speaker, i) => JSON.stringify({ idx: i + 1, start: i + 1, end: i + 1.8, speaker, text: `${speaker}字幕` })).join('\n'));
  const response = await page.request.post('/api/projects', { data: { name: `轨道-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl' } });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto('/'); await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, project.name).click();
  return project;
}

test('排序短长按后跟随指针并提前让位，取消不保存，释放不跳回起点', async ({ page }) => {
  const original = await fixture(page);
  const source = button(page, '选择轨道 甲'), target = button(page, '选择轨道 乙');
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!;
  const row = (await source.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " track ")]').boundingBox())!;
  const grabOffset = a.y + a.height / 2 - row.y;
  await page.mouse.move(a.x + 25, a.y + a.height / 2); await page.mouse.down();
  await page.waitForTimeout(230);
  await expect(page.getByLabel('轨道排序预览', { exact: true })).toBeVisible({ timeout: 100 });
  await page.mouse.move(b.x + 25, b.y + b.height / 2, { steps: 4 });
  await expect.poll(async () => (await target.boundingBox())!.y).toBeLessThan(b.y - 10);
  const ghost = (await page.getByLabel('轨道排序预览', { exact: true }).boundingBox())!;
  expect(Math.abs(ghost.y + grabOffset - (b.y + b.height / 2))).toBeLessThan(3);
  expect((await (await page.request.get(`/api/projects/${original.id}`)).json()).speakers).toEqual(original.speakers);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByLabel('轨道排序预览', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await target.boundingBox())!.y).toBeCloseTo(b.y, 0);
  await expect(button(page, '撤销')).toBeDisabled();
  await page.mouse.move(a.x + 25, a.y + a.height / 2); await page.mouse.down();
  await page.waitForTimeout(230);
  await page.mouse.move(b.x + 25, b.y + b.height / 2, { steps: 4 });
  const releaseY = (await source.boundingBox())!.y;
  await page.mouse.up();
  expect(Math.abs((await source.boundingBox())!.y - releaseY)).toBeLessThan(10);
  await expect(button(page, '撤销')).toBeEnabled();
  await button(page, '保存工程').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.speakers.slice(0, 3).map((s: { label: string }) => s.label)).toEqual(['乙', '甲', '丙']);
});

test('锁定贯穿总览、列表、键盘、批量和人物管理，保存重开及导出保持内容', async ({ page }) => {
  const original = await fixture(page);
  const save = async () => { await button(page, '保存工程').click(); await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存'); };
  await button(page, '锁定轨道 甲').click();
  await button(page, '列表字幕 1').click();
  await expect(page.getByLabel('字幕正文', { exact: true })).toBeDisabled();
  await expect(button(page, '删除选中字幕')).toBeDisabled();
  await page.keyboard.press('Delete'); await page.keyboard.press('ArrowDown');
  const clip = button(page, '字幕总览：甲字幕');
  await clip.dragTo(button(page, '字幕总览：乙字幕'));
  await button(page, '列表字幕 2').click({ modifiers: ['Control'] });
  await expect(button(page, '应用批量归属')).toBeDisabled();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  const card = page.getByRole('group', { name: '说话人 甲', exact: true });
  for (const label of ['编辑人物', '合并说话人', '删除人物', '删除轨道及字幕']) await expect(card.getByRole('button', { name: label, exact: true })).toBeDisabled();
  await save();
  const saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries).toEqual(original.entries); expect(saved.speakers[0].locked).toBe(true);
  const exported = await page.request.post(`/api/projects/${original.id}/exports`, { data: { revision: saved.revision, format: 'plain-srt' } });
  expect(exported.status()).toBe(201); expect(await (await page.request.get((await exported.json()).url)).text()).toContain('甲字幕');
  await page.reload(); await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, original.name).click();
  await expect(button(page, '解锁轨道 甲')).toBeVisible();
  await button(page, '解锁轨道 甲').click(); await button(page, '列表字幕 1').click();
  await expect(page.getByLabel('字幕正文', { exact: true })).toBeEnabled();
  await button(page, '撤销').click(); await expect(page.getByLabel('字幕正文', { exact: true })).toBeDisabled();
});

test('整轨删除确认取消与一步撤销恢复全部字幕，轨道入口可重命名', async ({ page }) => {
  const original = await fixture(page);
  await button(page, '管理说话人 甲').click();
  await page.getByLabel('人物名称', { exact: true }).fill('角色甲');
  await button(page, '应用人物设置').click();
  const card = page.getByRole('group', { name: '说话人 角色甲', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await card.getByRole('button', { name: '删除轨道及字幕', exact: true }).click();
  await expect(card).toBeVisible();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('1 条字幕'); return dialog.accept(); });
  await card.getByRole('button', { name: '删除轨道及字幕', exact: true }).click();
  await expect(card).toHaveCount(0);
  await button(page, '保存工程').click(); await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  let saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries).toEqual(original.entries.slice(1));
  await button(page, '撤销').click(); await expect(card).toBeVisible();
  await button(page, '保存工程').click(); await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries).toEqual(original.entries);
});

test('快速解锁编辑再锁定与连续撤销都能完整保存', async ({ page }) => {
  const original = await fixture(page);
  const save = async () => {
    await button(page, '保存工程').click();
    await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  };
  await button(page, '锁定轨道 甲').click(); await save();
  await button(page, '列表字幕 1').click();
  // Hold the debounce so unlock/edit/relock definitely share one PUT.
  await page.clock.install();
  await button(page, '解锁轨道 甲').click();
  await page.getByLabel('字幕正文', { exact: true }).fill('解锁后的正文');
  await button(page, '锁定轨道 甲').click(); await save();
  let saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries[0].text).toBe('解锁后的正文');
  expect(saved.speakers[0].locked).toBe(true);
  await button(page, '撤销').click();
  await button(page, '撤销').click();
  await button(page, '撤销').click();
  await save();
  saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries).toEqual(original.entries);
  expect(saved.speakers[0].locked).toBe(true);
});

test('当前工程移入七天回收站后关闭，恢复重新打开保留内容', async ({ page }) => {
  const original = await fixture(page);
  await button(page, '文件').click(); await button(page, '管理工程 / 回收站…').click();
  page.once('dialog', dialog => dialog.accept());
  await button(page, `删除工程 ${original.name}`).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('打开一段故事');
  expect((await page.request.get(`/api/projects/${original.id}`)).status()).toBe(404);
  await page.getByRole('button', { name: /^回收站 ·/ }).click();
  const card = page.getByRole('group', { name: `回收工程 ${original.name}`, exact: true });
  await expect(card).toContainText('自动清理');
  await card.getByRole('button', { name: '恢复工程', exact: true }).click();
  await expect(card).toHaveCount(0);
  await button(page, '工程列表').click(); await button(page, original.name).click();
  await expect(page.getByLabel('字幕列表', { exact: true })).toContainText('甲字幕');
  expect((await (await page.request.get(`/api/projects/${original.id}`)).json()).entries).toEqual(original.entries);
});
