import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/api';

async function openProject(page: Page, name: string) {
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function fixture(page: Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, '人物管理.jsonl');
  const rows = [
    { start: 1, end: 4, speaker: '甲', text: '甲的台词', tags: ['MULTI'], source_entries: [19, 2, 19] },
    { start: 1, end: 4, speaker: '甲', text: '甲的重叠' },
    { start: 2, end: 5, speaker: '乙', text: '乙的台词' },
    { start: 3, end: 6, speaker: 'Iroha&Kaguya', text: '组合台词' },
    { start: 5, end: 7, speaker: '?', text: '待定' },
    { start: 6, end: 8, speaker: 'NONSPEECH', text: '风声' },
  ];
  await fs.writeFile(subtitle, rows.map((row, i) => JSON.stringify({ idx: 90 + i, ...row })).join('\n'));
  const response = await page.request.post('/api/projects', { data: {
    name: `人物-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl',
  } });
  expect(response.status()).toBe(201);
  const project: Project = await response.json();
  await page.goto('/');
  await openProject(page, project.name);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  return project;
}

const card = (page: Page, label: string) => page.getByRole('group', { name: `说话人 ${label}`, exact: true });
async function saved(page: Page, project: Project) {
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  return await (await page.request.get(`/api/projects/${project.id}`)).json() as Project;
}
async function travel(page: Page, redo = false) {
  await page.getByRole('button', { name: redo ? '重做' : '撤销', exact: true }).click();
}

test('创建开放标签进入一步历史和自动保存，重开保留稳定人物身份且不改变字幕', async ({ page }) => {
  const project = await fixture(page);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '新增说话人', exact: true }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('新人物&同伴');
  await page.getByRole('button', { name: '应用人物设置', exact: true }).click();
  await expect(card(page, '新人物&同伴')).toBeVisible();
  const created = await saved(page, project);
  expect(created.entries).toEqual(project.entries);
  expect(created.speakers.map(s => s.label)).toEqual(['甲', '乙', 'Iroha&Kaguya', '新人物&同伴', '?', 'NONSPEECH']);
  expect(created.speakers.slice(-2)).toEqual(project.speakers.slice(-2).map((s, i) => ({ ...s, order: i + 4 })));
  await travel(page);
  expect((await saved(page, project)).speakers).toEqual(project.speakers);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await travel(page, true);
  expect((await saved(page, project)).speakers).toEqual(created.speakers);
  await page.reload();
  await openProject(page, project.name);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await expect(card(page, '新人物&同伴')).toBeVisible();
  expect((await saved(page, project)).speakers).toEqual(created.speakers);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
});

test('重命名及配色同步所有视图，冲突和取消不产生历史，保存提交有效人物草稿', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('button', { name: '字幕总览：甲的台词', exact: true }).click();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await card(page, '甲').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('乙');
  await page.getByRole('button', { name: '应用人物设置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('合并说话人');
  await expect(page.getByLabel('人物名称', { exact: true })).toBeFocused();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).speakers).toEqual(project.speakers);
  await page.getByRole('button', { name: '取消人物修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  // Merely opening/applying unchanged settings is not an edit.
  await card(page, '甲').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByRole('button', { name: '应用人物设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await card(page, '甲').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('甲的新名字');
  await page.keyboard.press('Control+s');
  const renamed = await saved(page, project);
  expect(renamed.entries).toEqual(project.entries);
  expect(renamed.speakers[0]).toEqual({ ...project.speakers[0], label: '甲的新名字' });
  await card(page, '甲的新名字').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByLabel('人物颜色', { exact: true }).fill('#ab1234');
  await page.getByRole('button', { name: '应用人物设置', exact: true }).click();
  const colored = await saved(page, project);
  expect(colored.speakers[0]).toEqual({ ...renamed.speakers[0], color: '#ab1234' });
  expect(colored.entries).toEqual(project.entries);
  const clip = page.getByRole('button', { name: '甲的新名字：甲的台词', exact: true });
  await expect(clip).toHaveCSS('background-color', 'rgb(171, 18, 52)');
  await expect(page.locator('.track-label').filter({ hasText: /^甲的新名字$/ })).toHaveCSS('color', 'rgb(171, 18, 52)');
  await page.getByRole('tab', { name: '字幕', exact: true }).click();
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('甲的新名字');
  await expect(page.getByRole('button', { name: '列表字幕 1', exact: true }).locator('.speaker-label')).toHaveCSS('color', 'rgb(171, 18, 52)');
  await travel(page);
  expect((await saved(page, project)).speakers).toEqual(renamed.speakers);
  await travel(page);
  expect((await saved(page, project)).speakers).toEqual(project.speakers);
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('甲');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await travel(page, true);
  await travel(page, true);
  expect((await saved(page, project)).speakers).toEqual(colored.speakers);
  await page.reload();
  await openProject(page, project.name);
  await expect(clip).toHaveCSS('background-color', 'rgb(171, 18, 52)');
  expect((await saved(page, project)).entries).toEqual(project.entries);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await page.screenshot({ path: '../tests/evidence/ticket-05-speaker-management.jpg', type: 'jpeg', quality: 85, fullPage: true });
});

test('真实拖动重排后换轨使用新顺序，撤销恢复目标，特殊轨固定且取消拖动无历史', async ({ page }) => {
  const project = await fixture(page);
  const handle = (label: string) => card(page, label).getByRole('button', { name: `拖动排序 ${label}`, exact: true });
  await handle('乙').dragTo(card(page, '甲'));
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨', '字幕总览', '乙', '甲', 'Iroha&Kaguya', '未标注 ?', '非对白 NONSPEECH']);
  const reordered = await saved(page, project);
  expect(reordered.speakers.map(s => s.id)).toEqual([project.speakers[1].id, project.speakers[0].id, ...project.speakers.slice(2).map(s => s.id)]);
  expect(reordered.entries).toEqual(project.entries);
  await page.getByRole('button', { name: '字幕总览：甲的台词', exact: true }).click();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('乙');
  await travel(page); // Attribution undo, then exactly one reorder undo.
  await travel(page);
  expect((await saved(page, project)).speakers).toEqual(project.speakers);
  await page.getByRole('button', { name: '字幕总览：甲的台词', exact: true }).focus();
  await page.keyboard.press('ArrowUp'); // Original first track, no change/history.
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('甲');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await travel(page, true);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  for (const label of ['?', 'NONSPEECH']) {
    await expect(card(page, label).getByRole('button')).toHaveCount(0);
    await handle('乙').dragTo(card(page, label));
    expect((await saved(page, project)).speakers).toEqual(reordered.speakers);
  }
  // Start a genuine drag, then cancel before dropping.
  const from = (await handle('乙').boundingBox())!;
  const to = (await card(page, '甲').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 20, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await saved(page, project)).speakers).toEqual(reordered.speakers);
  await travel(page);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await travel(page, true);
  await saved(page, project);
  await page.reload();
  await openProject(page, project.name);
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨', '字幕总览', '乙', '甲', 'Iroha&Kaguya', '未标注 ?', '非对白 NONSPEECH']);
  expect((await saved(page, project)).entries).toEqual(project.entries);
});

test('明确选择普通目标合并，重叠字幕和来源身份完整保留，一步撤销重做且自动保存', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('button', { name: '字幕总览：甲的台词', exact: true }).click();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await card(page, '甲').getByRole('button', { name: '合并说话人', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认合并', exact: true })).toBeDisabled();
  await expect(page.getByLabel('合并目标').locator('option')).toHaveText(['请选择目标人物', '乙', 'Iroha&Kaguya']);
  await page.getByRole('button', { name: '取消合并', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await card(page, '甲').getByRole('button', { name: '合并说话人', exact: true }).click();
  await page.getByLabel('合并目标').selectOption({ label: '乙' });
  await page.getByRole('button', { name: '确认合并', exact: true }).click();
  await expect(card(page, '甲')).toHaveCount(0);
  const merged = await saved(page, project);
  expect(merged.entries).toEqual(project.entries.map(e => e.speaker_id === project.speakers[0].id ? { ...e, speaker_id: project.speakers[1].id } : e));
  expect(merged.speakers).toEqual(project.speakers.slice(1).map((s, order) => ({ ...s, order })));
  for (const text of ['甲的台词', '甲的重叠', '乙的台词']) {
    await page.getByRole('button', { name: `乙：${text}`, exact: true }).click();
    await expect(page.getByLabel('字幕正文')).toHaveValue(text);
    await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('乙');
  }
  await travel(page);
  const restored = await saved(page, project);
  expect(restored.entries).toEqual(project.entries);
  expect(restored.speakers).toEqual(project.speakers);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await travel(page, true);
  expect((await saved(page, project)).entries).toEqual(merged.entries);
  await page.reload();
  await openProject(page, project.name);
  expect((await saved(page, project)).speakers).toEqual(merged.speakers);
  await page.getByRole('button', { name: '乙：甲的重叠', exact: true }).click();
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('乙');
});

test('删除有字幕人物转入未标注，空轨也能一步恢复，删除后新编辑清除重做分支', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('button', { name: '字幕总览：组合台词', exact: true }).click();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await card(page, 'Iroha&Kaguya').getByRole('button', { name: '删除人物', exact: true }).click();
  const deleted = await saved(page, project);
  expect(deleted.speakers.map(s => s.label)).toEqual(['甲', '乙', '?', 'NONSPEECH']);
  expect(deleted.entries).toEqual(project.entries.map(e => e.speaker_id === project.speakers[2].id ? { ...e, speaker_id: project.speakers[3].id } : e));
  await page.getByRole('tab', { name: '字幕', exact: true }).click();
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('?');
  await travel(page);
  expect((await saved(page, project)).entries).toEqual(project.entries);
  expect((await saved(page, project)).speakers).toEqual(project.speakers);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await travel(page, true);
  await saved(page, project);
  await page.reload();
  await openProject(page, project.name);
  await page.getByRole('button', { name: '未标注 ?：组合台词', exact: true }).click();
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('?');
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await page.getByRole('button', { name: '新增说话人', exact: true }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('空轨');
  await page.getByRole('button', { name: '应用人物设置', exact: true }).click();
  const added = await saved(page, project);
  await card(page, '空轨').getByRole('button', { name: '删除人物', exact: true }).click();
  expect((await saved(page, project)).entries).toEqual(deleted.entries);
  await travel(page);
  expect((await saved(page, project)).speakers).toEqual(added.speakers);
  await card(page, '空轨').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('新分支');
  await page.getByRole('button', { name: '应用人物设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeDisabled();
  const branched = await saved(page, project);
  expect(branched.speakers.find(s => s.label === '新分支')!.id).toBe(added.speakers.find(s => s.label === '空轨')!.id);
  expect(branched.entries).toEqual(deleted.entries);
});

test('再次编辑当前人物沿用刚提交的草稿，空名和保留名阻止保存导出，取消不写历史', async ({ page }) => {
  const project = await fixture(page);
  await card(page, '甲').getByRole('button', { name: '编辑人物', exact: true }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('新的甲');
  await card(page, '甲').getByRole('button', { name: '编辑人物', exact: true }).click();
  await expect(page.getByLabel('人物名称', { exact: true })).toHaveValue('新的甲');
  await page.getByRole('button', { name: '应用人物设置', exact: true }).click();
  const renamed = await saved(page, project);
  await travel(page);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await travel(page, true);
  await saved(page, project);
  for (const label of ['', '?', 'NONSPEECH']) {
    await page.getByRole('button', { name: '新增说话人', exact: true }).click();
    await page.getByLabel('人物名称', { exact: true }).fill(label);
    await page.getByRole('button', { name: '保存工程', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(label ? '合并说话人' : '不能为空');
    await page.getByRole('button', { name: '导出说话人 SRT', exact: true }).click();
    await expect(page.getByLabel('人物名称', { exact: true })).toBeFocused();
    const disk: Project = await (await page.request.get(`/api/projects/${project.id}`)).json();
    expect(disk.speakers).toEqual(renamed.speakers);
    expect(disk.exports).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('人物名称', { exact: true })).toHaveCount(0);
  }
  await travel(page);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  expect((await saved(page, project)).speakers).toEqual(project.speakers);
});
