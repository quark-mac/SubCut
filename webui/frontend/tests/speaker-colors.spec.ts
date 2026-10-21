import { expect, test, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/api';
import { nextSpeakerColor, optimizedSpeakerColors, specialColors } from '../src/speakerColors';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page, label: string) => page.getByRole('group', { name: `说话人 ${label}`, exact: true });
const colors = (project: Project) => Object.fromEntries(project.speakers.map(s => [s.id, s.color]));
async function readableClip(clip: Locator) {
  const result = await clip.evaluate(el => {
    const style = getComputedStyle(el);
    const numbers = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const base = numbers(style.backgroundColor), foreground = numbers(style.color);
    const luminance = (rgb: number[]) => rgb.reduce((sum, value, i) => {
      const v = value / 255;
      return sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
    }, 0);
    const endpoints = style.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [];
    return { image: style.backgroundImage, base: style.backgroundColor, foreground: style.color, contrast: endpoints.map(endpoint => {
      const overlay = numbers(endpoint), alpha = overlay[3] ?? 1;
      const background = base.slice(0, 3).map((v, i) => v * (1 - alpha) + overlay[i] * alpha);
      const values = [luminance(background), luminance(foreground)].sort((a, b) => a - b);
      return (values[1] + .05) / (values[0] + .05);
    }) };
  });
  expect(result.contrast, JSON.stringify(result)).toHaveLength(2);
  expect(Math.min(...result.contrast), JSON.stringify(result)).toBeGreaterThan(4.5);
  await expect(clip).toHaveCSS('opacity', '1');
}
async function open(page: Page, project: Project) {
  await page.goto('/'); await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, project.name).click();
}
async function fixture(page: Page, count = 8) {
  const file = path.resolve(`.test-workspace/inputs/colors-${Date.now()}.jsonl`);
  await fs.writeFile(file, Array.from({ length: count }, (_, i) => JSON.stringify({ idx: i + 1, start: .2, end: 6, speaker: `S${i}`, text: `人物${i}的台词` })).join('\n'));
  const response = await page.request.post('/api/projects', { data: { name: `配色-${Date.now()}`, media_path: path.resolve('.test-workspace/inputs/短片.mp4'), subtitle_path: file, format: 'normalized-jsonl' } });
  expect(response.status()).toBe(201);
  return await response.json() as Project;
}
async function save(page: Page, project: Project) {
  await button(page, '保存工程').click(); await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  return await (await page.request.get(`/api/projects/${project.id}`)).json() as Project;
}
async function seed(page: Page, project: Project) {
  const response = await page.request.put(`/api/projects/${project.id}`, { data: { revision: project.revision, name: project.name, speakers: project.speakers, entries: project.entries } });
  expect(response.status()).toBe(200); return await response.json() as Project;
}

test('导入和前端分配一致，超出固定色板仍唯一，开放名称不误作特殊轨', async ({ page }) => {
  const project = await fixture(page, 90);
  const occupied: string[] = [];
  for (const speaker of project.speakers.slice(0, -2)) {
    expect(speaker.color).toBe(nextSpeakerColor(occupied)); occupied.push(speaker.color);
  }
  expect(new Set(project.speakers.map(s => s.color)).size).toBe(92);
  for (const label of ['toString', '__proto__', 'constructor']) {
    const speakers = optimizedSpeakerColors([{ id: label, label, color: '#ffffff', order: 0 }]);
    expect(speakers[0].color).toMatch(/^#[0-9a-f]{6}$/);
  }
});

test('隐藏色仍占用，手动新增和归属创建不重配旧人，替换先保留所有同名色', async ({ page }) => {
  let project = await fixture(page, 5);
  project.speakers[0].visible = false;
  project = await seed(page, project); await open(page, project);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await button(page, '新增说话人').click(); await page.getByLabel('人物名称', { exact: true }).fill('手动新增');
  await button(page, '应用人物设置').click();
  let saved = await save(page, project);
  expect(new Set(saved.speakers.map(s => s.color)).size).toBe(saved.speakers.length);
  for (const s of project.speakers) expect(colors(saved)[s.id]).toBe(s.color);
  await page.getByRole('tab', { name: '字幕', exact: true }).click(); await button(page, '列表字幕 1').click();
  await page.getByLabel('说话人名称', { exact: true }).fill('输入创建'); await button(page, '应用修改').click();
  saved = await save(page, project);
  expect(new Set(saved.speakers.map(s => s.color)).size).toBe(saved.speakers.length);
  // Place new labels BEFORE retained labels; a later retained color must already be occupied.
  const file = path.resolve('.test-workspace/inputs/colors-replacement.jsonl');
  await fs.writeFile(file, ['替换新甲', '替换新乙', 'S0', '输入创建'].map((speaker, i) => JSON.stringify({ idx: i + 1, start: 1, end: 2, speaker, text: speaker })).join('\n'));
  await button(page, '替换字幕').click(); await page.getByLabel('导入格式').selectOption('normalized-jsonl');
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(file); await button(page, '解析预览').click(); await button(page, '应用替换').click();
  const replaced = await save(page, project);
  expect(new Set(replaced.speakers.map(s => s.color)).size).toBe(replaced.speakers.length);
  for (const label of ['S0', '输入创建', '?', 'NONSPEECH']) {
    const old = saved.speakers.find(s => s.label === label)!;
    expect(replaced.speakers.find(s => s.label === label)).toMatchObject({ id: old.id, color: old.color, visible: old.visible });
  }
  await button(page, '撤销').click(); expect((await save(page, project)).speakers).toEqual(saved.speakers);
  await button(page, '重做').click(); expect((await save(page, project)).speakers).toEqual(replaced.speakers);
});

test('优化预览取消无历史，确认一步撤销重做，隐藏和锁定特殊轨规则与保存重开', async ({ page }, info) => {
  let project = await fixture(page);
  project.speakers.forEach(s => { s.color = '#71a8cc'; });
  project.speakers[0].locked = true; project.speakers[1].locked = true;
  project.speakers[2].visible = false; project.speakers.at(-1)!.locked = true;
  project = await seed(page, project); await open(page, project);
  expect(colors(await save(page, project))).toEqual(colors(project)); // no migration on open
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await button(page, '优化轨道配色').click();
  const dialog = page.getByRole('dialog', { name: '优化轨道配色预览' });
  await expect(dialog).toContainText('无法识别以前的手动选色'); await expect(dialog).toContainText('无法自动消除'); await expect(dialog).toContainText('S2 · 已隐藏');
  await page.screenshot({ path: info.outputPath('color-preview.png') });
  await button(page, '取消配色优化').click(); await expect(button(page, '撤销')).toBeDisabled();
  expect(colors(await save(page, project))).toEqual(colors(project));
  await button(page, '优化轨道配色').click(); await page.keyboard.press('Control+z'); await expect(dialog).toBeVisible();
  await button(page, '应用优化配色').click(); const optimized = await save(page, project);
  expect(optimized.entries).toEqual(project.entries);
  for (const s of project.speakers.filter(s => s.locked)) expect(colors(optimized)[s.id]).toBe(s.color);
  const unlocked = optimized.speakers.filter(s => !s.locked);
  expect(unlocked.every(s => s.color !== '#71a8cc')).toBe(true);
  expect(new Set(unlocked.map(s => s.color)).size).toBe(unlocked.length);
  expect(optimized.speakers.find(s => s.label === '?')!.color).toBe(specialColors['?']);
  await button(page, '撤销').click(); await expect(button(page, '撤销')).toBeDisabled(); expect((await save(page, project)).speakers).toEqual(project.speakers);
  await button(page, '重做').click(); expect((await save(page, project)).speakers).toEqual(optimized.speakers);
  await open(page, optimized); expect((await save(page, project)).speakers).toEqual(optimized.speakers);
});

test('按身份保持颜色：排序隐藏重命名合并手选同色，实际正常选中锁定块保持对比', async ({ page }, info) => {
  const project = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1200 }); await open(page, project);
  await button(page, '按字幕数排序').click(); await button(page, '工程轨序').click();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await button(page, '拖动排序 S0').dragTo(card(page, 'S3'));
  expect(colors(await save(page, project))).toEqual(colors(project));
  await button(page, '隐藏轨道 S2').click(); await button(page, '显示轨道 S2').click();
  await card(page, 'S0').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('改名'); await button(page, '应用人物设置').click();
  expect(colors(await save(page, project))).toEqual(colors(project));
  await card(page, '改名').getByRole('button', { name: '合并说话人', exact: true }).click();
  await page.getByLabel('合并目标').selectOption(project.speakers[1].id); await button(page, '确认合并').click();
  expect(colors(await save(page, project))[project.speakers[1].id]).toBe(project.speakers[1].color);
  await card(page, 'S2').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByLabel('人物颜色', { exact: true }).fill(project.speakers[1].color); await button(page, '应用人物设置').click();
  expect(colors(await save(page, project))[project.speakers[2].id]).toBe(project.speakers[1].color);
  await button(page, '撤销').click(); await save(page, project);
  const normal = button(page, 'S2：人物2的台词'); await normal.scrollIntoViewIfNeeded();
  await expect(normal).not.toHaveClass(/selected|clip-locked/);
  await readableClip(normal); await normal.screenshot({ path: info.outputPath('normal-clip.png') });
  await expect(normal).toHaveCSS('background-color', `rgb(${[1, 3, 5].map(i => parseInt(project.speakers[2].color.slice(i, i + 2), 16)).join(', ')})`);
  await normal.click(); await expect(normal).toHaveClass(/selected/); await expect(normal).not.toHaveClass(/clip-locked/);
  await readableClip(normal); await normal.screenshot({ path: info.outputPath('selected-clip.png') });
  await button(page, '锁定轨道 S1').click(); await save(page, project);
  const clip = button(page, 'S1：人物1的台词'); await clip.scrollIntoViewIfNeeded(); await clip.click();
  await expect(clip).toHaveClass(/selected/); await expect(clip).toHaveClass(/clip-locked/);
  await readableClip(clip); await clip.screenshot({ path: info.outputPath('locked-selected-clip.png') });
  await expect(clip).toHaveCSS('opacity', '1'); await expect(clip).toHaveCSS('color', 'rgb(255, 255, 255)');
  const saved = await save(page, project);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  for (const s of saved.speakers.slice(0, 5)) {
    const title = button(page, `选择轨道 ${s.label}`);
    const rgb = await title.evaluate(el => getComputedStyle(el).color);
    await expect(card(page, s.label).locator('strong')).toHaveCSS('color', rgb);
    // Worst (lightest) gradient endpoint over the actual speaker color, white text.
    const bg = [1, 3, 5].map((i, j) => (parseInt(s.color.slice(i, i + 2), 16) * (1 - 148 / 255) + [8, 13, 22][j] * 148 / 255) / 255);
    const linear = bg.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    expect(1.05 / (.2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2] + .05)).toBeGreaterThan(4.5);
  }
  await page.screenshot({ path: info.outputPath('colored-tracks.png') });
  const overlay = page.getByLabel('播放字幕').getByText('[S1]', { exact: false });
  await expect(overlay).toHaveCount(2);
  for (const span of await overlay.all()) await expect(span).toHaveCSS('color', `rgb(${[1, 3, 5].map(i => parseInt(saved.speakers.find(s => s.label === 'S1')!.color.slice(i, i + 2), 16)).join(', ')})`);
  await open(page, saved); expect(colors(await save(page, project))).toEqual(colors(saved));
});
