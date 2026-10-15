import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Project } from '../src/api';

const inputs = path.resolve('.test-workspace/inputs');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const saved = (page: Page) => expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
const disk = async (page: Page, id: string): Promise<Project> => (await page.request.get(`/api/projects/${id}`)).json();
async function menu(page: Page, item: string) {
  await button(page, '文件').click(); await button(page, item).click();
}
async function open(page: Page, name: string) {
  await menu(page, '打开工程…'); await button(page, name).click();
}
async function fixture(page: Page) {
  const subtitle = path.join(inputs, `资源-${Date.now()}.jsonl`);
  await fs.writeFile(subtitle, [
    { idx: 72, start: 1, end: 3, speaker: '甲&乙', text: '完整来源\n第二行', tags: ['MULTI', 'CUSTOM'], source_entries: [91, 0, 91] },
    { idx: 9, start: 4, end: 6, speaker: '丙', text: '下一句', tags: ['MERGED'], source_entries: [8] },
  ].map(e => JSON.stringify(e)).join('\n'));
  const media = path.join(inputs, `资源原片-${Date.now()}.mp4`);
  await fs.copyFile(path.join(inputs, '短片.mp4'), media);
  const response = await page.request.post('/api/projects', { data: { name: `资源-${Date.now()}`, media_path: media, subtitle_path: subtitle, format: 'normalized-jsonl' } });
  expect(response.status()).toBe(201);
  const project: Project = await response.json();
  await page.goto('/'); await open(page, project.name);
  return project;
}

test('另存为提交有效人物与结构编辑，复制完整来源配置并独立切换重开', async ({ page }) => {
  const original = await fixture(page);
  await button(page, '列表字幕 1').click();
  await page.getByLabel('跳转时间', { exact: true }).fill('2'); await button(page, '跳转').click();
  await button(page, '拆分字幕').click();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await page.getByRole('group', { name: '说话人 甲&乙', exact: true }).getByRole('button', { name: '编辑人物' }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('组合人物');
  await page.getByLabel('人物颜色', { exact: true }).fill('#aa3377');
  await menu(page, '工程另存为…');
  await page.getByLabel('副本工程名称').fill(`${original.name}-副本`);
  const response = page.waitForResponse(r => r.url().endsWith('/save-as') && r.request().method() === 'POST');
  await button(page, '创建独立副本').click();
  const duplicate: Project = await (await response).json();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(duplicate.name);
  const before = await disk(page, original.id);
  expect(duplicate.id).not.toBe(original.id);
  for (const key of ['entries', 'speakers', 'subtitle_sources', 'media'] as const) expect(duplicate[key]).toEqual(before[key]);
  expect(duplicate.entries).toHaveLength(3);
  expect(duplicate.entries[0].sources[0].source_entries).toEqual([91, 0, 91]);
  expect(duplicate.entries[1].sources).toEqual(duplicate.entries[0].sources);
  expect(duplicate.entries[0].tags).toEqual(['MULTI', 'CUSTOM']);
  expect(duplicate.speakers[0]).toMatchObject({ label: '组合人物', color: '#aa3377' });
  await button(page, '列表字幕 1').click(); await page.getByRole('textbox', { name: '字幕正文', exact: true }).fill('副本独立修改');
  await open(page, original.name); // Switching saves current valid draft first.
  await saved(page);
  expect(await disk(page, original.id)).toEqual(before);
  expect((await disk(page, duplicate.id)).entries[0].text).toBe('副本独立修改');
  await page.reload(); await open(page, duplicate.name);
  await expect(button(page, '列表字幕 1')).toContainText('副本独立修改');
  await expect(button(page, '撤销')).toBeDisabled();
});

test('切换和另存为拒绝无效草稿，保存失败保留编辑历史且重试后恢复', async ({ page }) => {
  const original = await fixture(page);
  await button(page, '列表字幕 1').click();
  const editor = page.getByRole('textbox', { name: '字幕正文', exact: true });
  await editor.fill('');
  for (const action of ['打开工程…', '工程另存为…']) {
    await menu(page, action);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(editor).toHaveValue(''); await expect(editor).toBeFocused();
    expect(await disk(page, original.id)).toEqual(original);
  }
  await editor.fill('保存失败也不丢失');
  await page.route(`**/api/projects/${original.id}`, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, json: { error: { message: '磁盘只读，解除后重试' } } }) : route.continue());
  for (const action of ['打开工程…', '工程另存为…']) {
    await menu(page, action);
    await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('保存失败');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(editor).toHaveValue('保存失败也不丢失');
    await expect(button(page, '撤销')).toBeEnabled();
    expect(await disk(page, original.id)).toEqual(original);
  }
  await page.unroute(`**/api/projects/${original.id}`);
  await button(page, '重试保存').click(); await saved(page);
  expect((await disk(page, original.id)).entries[0].text).toBe('保存失败也不丢失');
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await page.getByRole('group', { name: '说话人 甲&乙', exact: true }).getByRole('button', { name: '编辑人物' }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('丙');
  await menu(page, '工程另存为…');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('人物名称', { exact: true })).toHaveValue('丙');
  await expect(page.getByLabel('人物名称', { exact: true })).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('合并说话人');
});

test('媒体移动仍可重开编辑，重定位验证身份且恢复实际播放位置，换短片失败不改原工程', async ({ page }) => {
  const original = await fixture(page);
  // Release the browser's file handle, move the real original, then reopen offline.
  await page.goto('about:blank');
  const moved = original.media.path.replace('.mp4', '-moved.mp4');
  await fs.rename(original.media.path, moved);
  await page.goto('/'); await open(page, original.name);
  await expect(page.getByRole('status', { name: '媒体资源状态' })).toHaveText('失联');
  await expect(button(page, '列表字幕 1')).toContainText('完整来源');
  await button(page, '列表字幕 2').click();
  await page.getByRole('textbox', { name: '字幕正文', exact: true }).fill('失联时修改');
  await button(page, '保存工程').click(); await saved(page);
  const offline = await disk(page, original.id);
  expect(offline.entries[1].text).toBe('失联时修改');
  await button(page, '重新定位原片').click();
  const other = path.join(inputs, `短片替换-${Date.now()}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', moved, '-t', '2', '-c', 'copy', other]);
  await page.getByLabel('新视频绝对路径').fill(other);
  await button(page, '验证并重新定位').click();
  await expect(page.getByRole('alert')).toContainText('不是同一原片');
  expect(await disk(page, original.id)).toEqual(offline);
  await page.getByLabel('新视频绝对路径').fill(moved);
  await button(page, '验证并重新定位').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status', { name: '媒体资源状态' })).toHaveText('可用');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => Math.round(v.currentTime * 1000))).toBe(4000);
  await button(page, '播放').click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(4.1);
  await button(page, '暂停').click();
  const restored = await disk(page, original.id);
  expect(restored.entries).toEqual(offline.entries);
  expect(restored.media.identity).toBe(original.media.identity);
  expect(restored.media.duration_ms).toBe(8000);
  await button(page, '用新视频建立工程').click();
  await page.getByLabel('新视频绝对路径').fill(other);
  await button(page, '创建独立副本').click();
  await expect(page.getByRole('alert')).toContainText('第');
  expect(await disk(page, original.id)).toEqual(restored);
  const different = path.join(inputs, `另一原片-${Date.now()}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', moved, '-an', '-c:v', 'copy', different]);
  await page.getByLabel('新视频绝对路径').fill(different);
  const created = page.waitForResponse(r => r.url().endsWith('/new-media'));
  await button(page, '创建独立副本').click();
  const newProject: Project = await (await created).json();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(newProject.name);
  expect(newProject.id).not.toBe(original.id);
  expect(newProject.media.identity).not.toBe(original.media.identity);
  expect(newProject.entries).toEqual(restored.entries);
  expect(newProject.speakers).toEqual(restored.speakers);
  expect(newProject.subtitle_sources).toEqual(restored.subtitle_sources);
  expect(await disk(page, original.id)).toEqual(restored);
  await open(page, original.name);
  await page.screenshot({ path: '../tests/evidence/ticket-10-relocated-resources.jpg', fullPage: true });
});

test('MOSS 整体替换、合并与人物排序后另存为保持来源，复制失败保留原工程可重试', async ({ page }) => {
  const original = await fixture(page);
  const subtitle = path.join(inputs, `替换来源-${Date.now()}.json`);
  await fs.writeFile(subtitle, JSON.stringify([
    { id: 'seg-77', start: 1, end: 2, speaker: 'S00', text: 'MOSS 甲' },
    { id: 'seg-77', start: 2, end: 3, speaker: 'S00', text: 'MOSS 乙' },
    { id: 'seg-19', start: 4, end: 5, speaker: 'S01', text: 'MOSS 丙' },
  ]));
  await button(page, '替换字幕').click();
  await page.getByRole('combobox', { name: '导入格式', exact: true }).selectOption('moss-json');
  await page.getByLabel('字幕绝对路径').fill(subtitle);
  await button(page, '解析预览').click(); await button(page, '应用替换').click();
  await button(page, '列表字幕 1').click(); await button(page, '列表字幕 2').click({ modifiers: ['Control'] });
  await button(page, '合并字幕').click();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await page.getByRole('button', { name: '拖动排序 S01', exact: true }).dragTo(page.getByRole('group', { name: '说话人 S00', exact: true }));
  await menu(page, '工程另存为…');
  const source = await disk(page, original.id);
  expect(source.entries[0].sources.map(s => s.moss_id)).toEqual(['seg-77', 'seg-77']);
  expect(source.entries[0].sources.map(s => s.source_entries)).toEqual([[], []]);
  expect(source.speakers.map(s => s.label)).toEqual(['S01', 'S00', '?', 'NONSPEECH']);
  await page.route(`**/api/projects/${original.id}/save-as`, route => route.fulfill({ status: 500, json: { error: { message: '副本目录不可写' } } }));
  await button(page, '创建独立副本').click();
  await expect(page.getByRole('dialog')).toContainText('副本目录不可写');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(original.name);
  expect(await disk(page, original.id)).toEqual(source);
  await page.unroute(`**/api/projects/${original.id}/save-as`);
  const response = page.waitForResponse(r => r.url().endsWith('/save-as'));
  await button(page, '创建独立副本').click();
  const duplicate = await (await response).json();
  for (const key of ['entries', 'speakers', 'subtitle_sources', 'media'] as const) expect(duplicate[key]).toEqual(source[key]);
  await saved(page);
});

test('资源区打开实际导出位置，Windows Explorer 窗口与真实文件一致', async ({ page }) => {
  test.skip(process.platform !== 'win32', 'Windows 本机资源管理器验收');
  const project = await fixture(page);
  await button(page, '导出说话人 SRT').click(); await saved(page);
  await expect(button(page, '打开导出位置')).toBeVisible();
  const exported = (await disk(page, project.id)).exports[0];
  const folder = path.dirname(exported.path);
  const windows = () => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); $s=New-Object -ComObject Shell.Application; $items=@($s.Windows() | ForEach-Object { try { [pscustomobject]@{path=$_.Document.Folder.Self.Path; hwnd=[long]$_.HWND} } catch {} }); ConvertTo-Json -InputObject $items -Compress",
  ], { encoding: 'utf8' }).trim() || '[]') as { path: string; hwnd: number }[];
  const before = windows();
  const response = page.waitForResponse(r => r.url().endsWith('/open-location'));
  try {
    await button(page, '打开导出位置').click();
    const receipt = await (await response).json();
    expect(receipt).toMatchObject({ project_id: project.id, export_id: exported.id, opened: true, path: folder });
    await expect.poll(() => windows().some(w => w.path.toLowerCase() === folder.toLowerCase()), { timeout: 15000 }).toBe(true);
    const actual = windows().find(w => w.path.toLowerCase() === folder.toLowerCase())!;
    expect(before.some(w => w.hwnd === actual.hwnd && w.path === folder)).toBe(false);
    expect(await fs.readFile(exported.path, 'utf8')).toContain('[甲&乙] 完整来源\n第二行');
    const resources = await (await page.request.get(`/api/projects/${project.id}/resources`)).json();
    expect(resources.exports[0]).toMatchObject({ id: exported.id, status: 'available', path: exported.path });
    await fs.writeFile('../tests/evidence/ticket-10-export-location.json', JSON.stringify({ platform: process.platform,
      verifiedAt: new Date().toISOString(), receipt, explorer: actual, exported, resources }, null, 2));
    await page.screenshot({ path: '../tests/evidence/ticket-10-export-location.jpg', fullPage: true });
  } finally {
    // Close only the unique export folder opened by this test, never the user's other windows.
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `$s=New-Object -ComObject Shell.Application; @($s.Windows()) | ForEach-Object { try { if ($_.Document.Folder.Self.Path -eq '${folder.replaceAll("'", "''")}') { $_.Quit() } } catch {} }`]);
  }
});
