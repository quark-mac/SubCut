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
  const subtitle = path.join(inputs, '多轨.jsonl');
  // Source order deliberately differs from time order; ordinary labels follow first occurrence.
  const rows = [
    { start: 3, end: 5, speaker: '丙', text: '丙的后句' },
    { start: 1, end: 4, speaker: '甲', text: '甲的第一句' },
    { start: 1, end: 4, speaker: '甲', text: '甲的同时间句' },
    { start: 2, end: 3, speaker: '乙', text: '乙的跨轨句' },
    { start: 5, end: 6, speaker: '?', text: '待定句' },
    { start: 6, end: 7.5, speaker: 'NONSPEECH', text: '风声' },
  ];
  await fs.writeFile(subtitle, rows.map((row, i) => JSON.stringify({ idx: i + 1, ...row })).join('\n'));
  const response = await page.request.post('/api/projects', { data: {
    name: `多轨-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl',
  } });
  expect(response.status()).toBe(201);
  const project: Project = await response.json();
  await page.goto('/');
  await openProject(page, project.name);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  return project;
}

async function save(page: Page) {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
}

test('单条按轨道顺序换轨、边界不循环，一步历史与保存重开保留稳定身份', async ({ page }) => {
  const project = await fixture(page);
  const clip = (label: string) => page.getByRole('button', { name: `${label}：甲的第一句`, exact: true });
  await clip('字幕总览').click();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel('说话人名称')).toHaveValue('丙');
  await expect(clip('丙')).toHaveClass(/selected/);
  await expect(clip('字幕总览')).toHaveClass(/selected/);
  await page.keyboard.press('ArrowUp'); // Upper boundary, never video/overview.
  await expect(page.getByLabel('说话人名称')).toHaveValue('丙');
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('说话人名称')).toHaveValue('甲');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByLabel('说话人名称')).toHaveValue('丙');
  for (const label of ['甲', '乙', '?', 'NONSPEECH']) {
    await page.keyboard.press('ArrowDown');
    await expect(page.getByLabel('说话人名称')).toHaveValue(label);
    await expect(page.getByLabel('开始时间（毫秒）')).toHaveValue('1000');
    await expect(page.getByLabel('结束时间（毫秒）')).toHaveValue('4000');
  }
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('说话人名称')).toHaveValue('NONSPEECH');
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('说话人名称')).toHaveValue('?');
  await page.keyboard.press('Control+Shift+z');
  await save(page);
  const saved: Project = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const target = project.entries.find(e => e.text === '甲的第一句')!;
  expect(saved.entries).toEqual(project.entries.map(e => e.id === target.id
    ? { ...e, speaker_id: project.speakers.find(s => s.label === 'NONSPEECH')!.id } : e));
  expect(saved.speakers).toEqual(project.speakers);
  await page.reload();
  await openProject(page, project.name);
  await clip('非对白 NONSPEECH').click();
  await expect(page.getByLabel('说话人名称')).toHaveValue('NONSPEECH');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
});

test('轨序配色一致，同轨同时间错层可点击，跨视图正文时间归属同步且导出不复制条目', async ({ page }) => {
  const project = await fixture(page);
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨', '字幕总览', '丙', '甲', '乙', '未标注 ?', '非对白 NONSPEECH']);
  const row = page.getByRole('button', { name: '列表字幕 1', exact: true });
  const first = page.getByRole('button', { name: '甲：甲的第一句', exact: true });
  const same = page.getByRole('button', { name: '甲：甲的同时间句', exact: true });
  const color = await first.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await row.locator('.speaker-label').evaluate(el => getComputedStyle(el).color)).toBe(color);
  expect(await page.locator('.track-label').filter({ hasText: /^甲$/ }).evaluate(el => getComputedStyle(el).color)).toBe(color);
  await first.click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲的第一句');
  await expect(row).toHaveClass(/selected/);
  await same.click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲的同时间句');
  const a = (await first.boundingBox())!, b = (await same.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  await page.getByRole('button', { name: '乙：乙的跨轨句', exact: true }).click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('乙的跨轨句');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 2);
  await page.getByRole('button', { name: '字幕总览：甲的第一句', exact: true }).click();
  await page.getByLabel('字幕正文').fill('共享修改\n保留换行');
  await page.getByLabel('开始时间（毫秒）').fill('1250');
  await page.getByLabel('说话人归属').selectOption('乙');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  const overview = page.getByRole('button', { name: '字幕总览：共享修改 保留换行', exact: true });
  const person = page.getByRole('button', { name: '乙：共享修改 保留换行', exact: true });
  await expect(overview).toHaveClass(/selected/);
  await expect(person).toHaveClass(/selected/);
  await person.click();
  await expect(page.getByLabel('开始时间（毫秒）')).toHaveValue('1250');
  await expect(page.getByLabel('播放字幕')).toContainText('共享修改');
  await expect(page.getByLabel('字幕列表')).toContainText('共享修改');
  await save(page);
  const saved: Project = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(saved.entries).toHaveLength(6);
  expect(saved.entries.map(e => e.id)).toEqual(project.entries.map(e => e.id));
  expect(saved.entries.filter(e => e.text !== '共享修改\n保留换行')).toEqual(project.entries.filter(e => e.text !== '甲的第一句'));
  const exported = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '导出说话人 SRT', exact: true }).click();
  const result = await (await exported).json();
  const output = await fs.readFile(result.export.path, 'utf8');
  expect(output.match(/-->/g)).toHaveLength(6);
  expect(output).toContain('00:00:01,250 --> 00:00:04,000\n[乙] 共享修改\n保留换行');
});

test('左右选择空格播放与 Esc 清除不写历史，播放高亮不抢草稿，输入及对话框隔离快捷键', async ({ page }) => {
  const project = await fixture(page);
  const first = page.getByRole('button', { name: '字幕总览：甲的第一句', exact: true });
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const video = page.locator('video');
  await first.click();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲的同时间句');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('字幕正文')).toHaveValue('乙的跨轨句');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 2);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲的第一句');
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.getByLabel('字幕正文').fill('仍在编辑的草稿');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(2.2);
  await expect(page.getByRole('button', { name: '字幕总览：乙的跨轨句', exact: true })).toHaveClass(/active/);
  await expect(first).toHaveClass(/selected/);
  await expect(page.getByLabel('字幕正文')).toHaveValue('仍在编辑的草稿');
  await expect(page.getByLabel('字幕正文')).toBeFocused();
  await page.getByLabel('字幕正文').press('Escape');
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲的第一句');
  await page.getByLabel('字幕正文').press('ArrowDown');
  await page.getByLabel('字幕正文').press('ArrowUp');
  await page.getByLabel('字幕正文').press('ArrowRight');
  await expect(page.getByLabel('说话人名称')).toHaveValue('甲');
  await page.getByLabel('说话人名称').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('说话人名称')).toHaveValue('甲');
  await first.focus();
  await page.keyboard.press('Space');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(undo).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('字幕正文')).toHaveCount(0);
  await expect(page.locator('.selected')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft'); // With no selection, choose last.
  await expect(page.getByLabel('字幕正文')).toHaveValue('风声');
  await page.keyboard.press('ArrowRight'); // Last boundary.
  await expect(page.getByLabel('字幕正文')).toHaveValue('风声');
  await page.getByRole('button', { name: '帮助', exact: true }).click();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(video).toHaveJSProperty('paused', true);
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await expect(page.getByLabel('说话人名称')).toHaveValue('NONSPEECH');
  await expect(undo).toBeDisabled();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).revision).toBe(project.revision);
});

test('缩放和双向滚动后播放头仍按原片坐标更新实际帧，Esc 取消拖动且导航不写历史', async ({ page }) => {
  const project = await fixture(page);
  const video = page.locator('video');
  const frame = () => video.evaluate((v: HTMLVideoElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    return canvas.toDataURL();
  });
  await page.getByRole('button', { name: '字幕总览：甲的第一句', exact: true }).click();
  await expect(video).toHaveJSProperty('seeking', false);
  const firstFrame = await frame();
  const zoom = page.getByLabel('时间轴缩放', { exact: true });
  await zoom.focus();
  await zoom.press('ArrowRight'); // 2x fit, kept separate from entry navigation.
  await expect(page.getByLabel('缩放倍率')).toHaveText('2×');
  const viewport = page.getByRole('region', { name: '时间轴轨道滚动区' });
  await viewport.hover();
  await page.mouse.wheel(10000, 0);
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(500);
  const ruler = page.getByLabel('原片时间刻度', { exact: true });
  const rect = (await ruler.boundingBox())!;
  const x = rect.x + rect.width * 0.75; // 6 seconds on an 8-second source, after zoom + scroll.
  await page.mouse.move(x - 80, rect.y + 12);
  await page.mouse.down();
  await page.mouse.move(x, rect.y + 12, { steps: 8 });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(6, 1);
  await expect(video).toHaveJSProperty('seeking', false);
  const sixthFrame = await frame();
  expect(sixthFrame).not.toBe(firstFrame);
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲的第一句');
  await page.mouse.up();
  await expect(page.getByLabel('播放位置')).toContainText('00:00:06.');
  await page.getByRole('button', { name: '拖动播放头' }).hover();
  await page.mouse.down();
  await page.mouse.move(x + 120, rect.y + 12, { steps: 5 });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(6.2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(6, 1);
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲的第一句');
  // Vertical wheel reaches fixed bottom special labels; no data/selection changes.
  await viewport.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '非对白 NONSPEECH：风声', exact: true }).click();
  await expect(page.getByLabel('开始时间（毫秒）')).toHaveValue('6000');
  await expect(video).toHaveJSProperty('seeking', false);
  expect(await frame()).toBe(sixthFrame);
  await page.getByRole('button', { name: '适合全片', exact: true }).click();
  await expect(page.getByLabel('缩放倍率')).toHaveText('1×');
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  const saved: Project = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(saved).toEqual(project);
  expect((await page.request.get(`/api/projects/${project.id}/media`, { headers: { Range: 'bytes=0-99' } })).status()).toBe(206);
});

test('全片缩放下片尾一毫秒同轨条目仍可分别点击，拖动超出原片时限会停在边界', async ({ page }) => {
  const project = await fixture(page);
  const entries = project.entries.map((e, index) => index === 1 || index === 2 ? { ...e, start_ms: 7999, end_ms: 8000 } : e);
  const response = await page.request.put(`/api/projects/${project.id}`, { data: { revision: project.revision, name: project.name, entries } });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await openProject(page, project.name);
  for (const text of ['甲的第一句', '甲的同时间句']) {
    await page.getByRole('button', { name: `甲：${text}`, exact: true }).click({ timeout: 3000 });
    await expect(page.getByLabel('字幕正文')).toHaveValue(text);
    await expect(page.getByLabel('开始时间（毫秒）')).toHaveValue('7999');
  }
  const ruler = page.getByLabel('原片时间刻度', { exact: true });
  const rect = (await ruler.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(rect.x - 20, rect.y + 10);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(0);
  await page.mouse.move(rect.x + rect.width + 10, rect.y + 10);
  await page.mouse.up();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(8);
  await expect(page.getByLabel('播放位置')).toHaveText('00:00:08.000 / 00:00:08.000');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries).toEqual(entries);
});
