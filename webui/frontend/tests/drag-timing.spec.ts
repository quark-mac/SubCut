import { expect, test, type Page, type Locator } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Entry, Project } from '../src/api';

async function open(page: Page, name: string) {
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function fixture(page: Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, '拖动.jsonl');
  await fs.writeFile(subtitle, [
    { idx: 11, start: 1, end: 2, speaker: '甲', text: '移动这句', tags: ['MULTI'], source_entries: [9, 9, 2] },
    { idx: 12, start: 1.5, end: 3, speaker: '甲', text: '保留重叠' },
    { idx: 13, start: 3.5, end: 4, speaker: '乙', text: '边界目标' },
    { idx: 14, start: 5, end: 6, speaker: '丙', text: '第三轨' },
    { idx: 15, start: 7.999, end: 8, speaker: '?', text: '一毫秒' },
  ].map(row => JSON.stringify(row)).join('\n'));
  const response = await page.request.post('/api/projects', { data: {
    name: `拖动-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl',
  } });
  expect(response.status()).toBe(201);
  const project: Project = await response.json();
  await page.goto('/');
  await open(page, project.name);
  return project;
}

const clip = (page: Page, track = '字幕总览', text = '移动这句') => page.getByRole('button', { name: `${track}：${text}`, exact: true });
const saved = async (page: Page, project: Project): Promise<Project> => (await page.request.get(`/api/projects/${project.id}`)).json();
const undo = (page: Page) => page.getByRole('button', { name: '撤销', exact: true });
const redo = (page: Page) => page.getByRole('button', { name: '重做', exact: true });

async function fields(page: Page, start: number, end: number, speaker = '甲') {
  await expect(page.getByLabel('开始时间（毫秒）')).toHaveValue(String(start));
  await expect(page.getByLabel('结束时间（毫秒）')).toHaveValue(String(end));
  await expect(page.getByLabel('说话人名称')).toHaveValue(speaker);
}

async function begin(page: Page, target: Locator, delta: number) {
  await target.scrollIntoViewIfNeeded();
  await target.hover(); // Account for the sticky ruler before starting a real pointer gesture.
  const rect = (await target.boundingBox())!;
  const ruler = (await page.getByLabel('原片时间刻度', { exact: true }).boundingBox())!;
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta / 8000 * ruler.width, y, { steps: 8 });
  return { x, y, width: ruler.width };
}

async function checkSaved(page: Page, original: Project, changes: Partial<Entry>) {
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const result = await saved(page, original);
  expect(result.entries).toEqual(original.entries.map((e, i) => i === 0 ? { ...e, ...changes } : e));
  expect(result.speakers).toEqual(original.speakers);
  expect(result.subtitle_sources).toEqual(original.subtitle_sources);
  return result;
}

test('横拖预览不落盘，释放只提交一步历史，双视图与重开一致', async ({ page }) => {
  const project = await fixture(page);
  await begin(page, clip(page), 1000);
  await fields(page, 2000, 3000);
  await page.waitForTimeout(850); // Longer than the real autosave delay while the pointer remains down.
  expect(await saved(page, project)).toEqual(project);
  await expect(undo(page)).toBeDisabled();
  await page.mouse.up();
  await fields(page, 2000, 3000);
  await expect(clip(page, '甲')).toHaveAttribute('title', /00:00:02.000 → 00:00:03.000/);
  await checkSaved(page, project, { start_ms: 2000, end_ms: 3000 });
  await undo(page).click();
  await fields(page, 1000, 2000);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await fields(page, 2000, 3000);
  await checkSaved(page, project, { start_ms: 2000, end_ms: 3000 });
  await page.reload();
  await open(page, project.name);
  await clip(page, '甲').click();
  await fields(page, 2000, 3000);
  await expect(undo(page)).toBeDisabled();
  await page.screenshot({ path: '../tests/evidence/ticket-06-drag-timing.jpg', type: 'jpeg', quality: 85, fullPage: true });
});

async function toTrack(page: Page, label: string, x: number) {
  const target = page.locator('.track-label').filter({ hasText: new RegExp(`^${label}$`) });
  await target.scrollIntoViewIfNeeded();
  const rect = (await target.boundingBox())!;
  await page.mouse.move(x, rect.y + rect.height / 2, { steps: 10 });
}

test('纵拖仅换轨，斜拖时间归属一步提交，总览和无效目标保留归属', async ({ page }) => {
  const project = await fixture(page);
  const a = await begin(page, clip(page, '甲'), 0);
  await toTrack(page, '乙', a.x);
  await page.mouse.up();
  await fields(page, 1000, 2000, '乙');
  await checkSaved(page, project, { speaker_id: project.speakers.find(s => s.label === '乙')!.id });
  await undo(page).click();
  await fields(page, 1000, 2000);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await fields(page, 1000, 2000, '乙');
  await undo(page).click();

  const b = await begin(page, clip(page), 500);
  await toTrack(page, '丙', b.x + b.width / 16);
  await page.mouse.up();
  await fields(page, 1500, 2500, '丙');
  const changes = { start_ms: 1500, end_ms: 2500, speaker_id: project.speakers.find(s => s.label === '丙')!.id };
  await checkSaved(page, project, changes);
  await undo(page).click();
  await fields(page, 1000, 2000);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await fields(page, 1500, 2500, '丙');
  await checkSaved(page, project, changes);

  const c = await begin(page, clip(page, '丙'), 0);
  await toTrack(page, '字幕总览', c.x);
  await page.mouse.up();
  await fields(page, 1500, 2500, '丙');
  const d = await begin(page, clip(page), 0);
  await toTrack(page, '🔒 视频轨', d.x);
  await page.mouse.up();
  await fields(page, 1500, 2500, '丙');
  await undo(page).click(); // Both no-op drops must not consume an undo step.
  await fields(page, 1000, 2000);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await checkSaved(page, project, changes);
  await page.reload();
  await open(page, project.name);
  await clip(page, '丙').click();
  await fields(page, 1500, 2500, '丙');
});

test('两端 resize 和整体移动限制媒体边界及一毫秒时长，保留重叠和未选条目', async ({ page }) => {
  const project = await fixture(page);
  const scenarios = [
    { edge: '开始边界', delta: 500, start: 1500, end: 2000 },
    { edge: '结束边界', delta: 1000, start: 1000, end: 3000 },
    { edge: '开始边界', delta: 3000, start: 1999, end: 2000 },
    { edge: '结束边界', delta: -3000, start: 1000, end: 1001 },
    { edge: '开始边界', delta: -3000, start: 0, end: 2000 },
    { edge: '结束边界', delta: 9000, start: 1000, end: 8000 },
    { edge: '', delta: -3000, start: 0, end: 1000 },
    { edge: '', delta: 9000, start: 7000, end: 8000 },
  ];
  for (const scenario of scenarios) {
    const target = clip(page, '甲');
    await begin(page, scenario.edge ? target.getByLabel(scenario.edge, { exact: true }) : target, scenario.delta);
    await page.mouse.up();
    await fields(page, scenario.start, scenario.end);
    await checkSaved(page, project, { start_ms: scenario.start, end_ms: scenario.end });
    await undo(page).click();
    await fields(page, 1000, 2000);
    await expect(undo(page)).toBeDisabled();
    await redo(page).click();
    await fields(page, scenario.start, scenario.end);
    await undo(page).click();
  }
  await checkSaved(page, project, {});
});

test('吸附可开关，整块与两端吸附播放头和其他字幕边界，关闭保留自由毫秒结果', async ({ page }) => {
  const project = await fixture(page);
  const snap = page.getByRole('button', { name: '吸附', exact: true });
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  const ruler = (await page.getByLabel('原片时间刻度', { exact: true }).boundingBox())!;
  await page.mouse.click(ruler.x + ruler.width * 2750 / 8000, ruler.y + 12);
  const cases = [
    { edge: '', delta: 730, start: 1750, end: 2750 }, // Moving end to playhead; duration preserved.
    { edge: '', delta: 1480, start: 2500, end: 3500 }, // Moving end to another entry's start.
    { edge: '开始边界', delta: 480, start: 1500, end: 2000 },
    { edge: '结束边界', delta: 730, start: 1000, end: 2750 },
    { edge: '结束边界', delta: 1480, start: 1000, end: 3500 },
  ];
  for (const sample of cases) {
    const target = sample.edge ? clip(page).getByLabel(sample.edge, { exact: true }) : clip(page);
    await begin(page, target, sample.delta);
    await page.mouse.up();
    await fields(page, sample.start, sample.end);
    await checkSaved(page, project, { start_ms: sample.start, end_ms: sample.end });
    await undo(page).click();
    await fields(page, 1000, 2000);
    await expect(undo(page)).toBeDisabled();
  }
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', 'false');
  await begin(page, clip(page), 1480);
  await page.mouse.up();
  await fields(page, 2480, 3480);
  await checkSaved(page, project, { start_ms: 2480, end_ms: 3480 });
  await undo(page).click();
  await redo(page).click();
  await fields(page, 2480, 3480);
  await checkSaved(page, project, { start_ms: 2480, end_ms: 3480 });
});

test('Esc 取消横斜拖和 resize 恢复预览且不增加历史，保留既有重做分支', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('button', { name: '吸附', exact: true }).click();
  await begin(page, clip(page), 500);
  await page.mouse.up();
  await undo(page).click();
  await checkSaved(page, project, {});
  for (const edge of ['', '开始边界', '结束边界']) {
    const start = await begin(page, edge ? clip(page).getByLabel(edge, { exact: true }) : clip(page), 250);
    if (!edge) await toTrack(page, '乙', start.x + start.width / 32);
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(750);
    expect((await saved(page, project)).entries).toEqual(project.entries);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await fields(page, 1000, 2000);
    await expect(clip(page)).toHaveClass(/selected/);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeEnabled();
    await checkSaved(page, project, {});
  }
  await redo(page).click();
  await fields(page, 1500, 2500);
  await checkSaved(page, project, { start_ms: 1500, end_ms: 2500 });
});

test('2× 与 8× 缩放横纵滚动后按原片毫秒拖动，手势中滚动也立即更新预览', async ({ page }) => {
  let project = await fixture(page);
  const response = await page.request.put(`/api/projects/${project.id}`, { data: {
    revision: project.revision, name: project.name,
    entries: project.entries.map((e, i) => i === 0 ? { ...e, start_ms: 5000, end_ms: 6000 } : e),
  } });
  expect(response.ok()).toBeTruthy();
  project = await response.json();
  await page.reload();
  await open(page, project.name);
  await page.getByRole('button', { name: '吸附', exact: true }).click();
  const zoom = page.getByLabel('时间轴缩放', { exact: true });
  const viewport = page.getByRole('region', { name: '时间轴轨道滚动区' });
  for (const level of [1, 3]) {
    await zoom.focus();
    await zoom.fill(String(level));
    await expect(page.getByLabel('缩放倍率')).toHaveText(`${2 ** level}×`);
    await viewport.hover();
    await page.mouse.wheel(10000, 1000);
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await begin(page, clip(page, '甲'), 125);
    await page.mouse.up();
    await fields(page, 5125, 6125);
    await checkSaved(page, project, { start_ms: 5125, end_ms: 6125 });
    await undo(page).click();
    await fields(page, 5000, 6000);
    await expect(undo(page)).toBeDisabled();
  }
  // Keep the pointer fixed while the real wheel moves source time underneath it.
  await begin(page, clip(page, '甲'), 100);
  const before = Number(await page.getByLabel('开始时间（毫秒）').inputValue());
  await page.mouse.wheel(100, 0);
  await expect.poll(async () => Number(await page.getByLabel('开始时间（毫秒）').inputValue())).toBeGreaterThan(before + 50);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await fields(page, 5000, 6000);
  await checkSaved(page, project, {});
});

test('高倍率吸附使用屏幕距离，关闭后可微调一毫秒，极短块移动不改变真实时长', async ({ page }) => {
  const project = await fixture(page);
  const zoom = page.getByLabel('时间轴缩放', { exact: true });
  await zoom.focus();
  await zoom.press('End');
  await expect(page.getByLabel('缩放倍率')).toHaveText('8×');
  const snap = page.getByRole('button', { name: '吸附', exact: true });
  // At fit zoom 20 ms was within 8 px; here it is outside that screen distance.
  await begin(page, clip(page), 1480);
  await page.mouse.up();
  await fields(page, 2480, 3480);
  await undo(page).click();
  await begin(page, clip(page), 1496);
  await page.mouse.up();
  await fields(page, 2500, 3500);
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  await snap.click();
  const start = await begin(page, clip(page).getByLabel('开始边界', { exact: true }), 10);
  await page.mouse.move(start.x + start.width / 8000, start.y); // Return to +1 ms after activating the drag.
  await page.mouse.up();
  await fields(page, 1001, 2000);
  await checkSaved(page, project, { start_ms: 1001, end_ms: 2000 });
  await undo(page).click();
  await fields(page, 1000, 2000);
  await redo(page).click();
  await checkSaved(page, project, { start_ms: 1001, end_ms: 2000 });
  await page.reload();
  await open(page, project.name);
  await clip(page).click();
  await fields(page, 1001, 2000);
  await expect(undo(page)).toBeDisabled();

  await snap.click(); // Reopened timeline starts with snapping enabled.
  await begin(page, clip(page, '未标注 ?', '一毫秒'), -125);
  await page.mouse.up();
  await fields(page, 7874, 7875, '?');
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const result = await saved(page, project);
  expect(result.entries).toEqual(project.entries.map((e, i) => i === 0 ? { ...e, start_ms: 1001 } : i === 4 ? { ...e, start_ms: 7874, end_ms: 7875 } : e));
  await undo(page).click();
  await fields(page, 7999, 8000, '?');
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await fields(page, 7874, 7875, '?');
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  await page.reload();
  await open(page, project.name);
  await clip(page, '未标注 ?', '一毫秒').click();
  await fields(page, 7874, 7875, '?');
  await snap.click();
  for (const sample of [{ edge: '开始边界', delta: -125, start: 7749, end: 7875 }, { edge: '结束边界', delta: 125, start: 7874, end: 8000 }]) {
    await begin(page, clip(page, '未标注 ?', '一毫秒').getByLabel(sample.edge, { exact: true }), sample.delta);
    await page.mouse.up();
    await fields(page, sample.start, sample.end, '?');
    await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
    const resized = await saved(page, project);
    expect(resized.entries).toEqual(result.entries.map((e, i) => i === 4 ? { ...e, start_ms: sample.start, end_ms: sample.end } : e));
    await undo(page).click();
    await fields(page, 7874, 7875, '?');
    await expect(undo(page)).toBeDisabled();
    await redo(page).click();
    await fields(page, sample.start, sample.end, '?');
    if (sample.edge === '结束边界') {
      await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
      await page.reload();
      await open(page, project.name);
      await clip(page, '未标注 ?', '一毫秒').click();
      await fields(page, sample.start, sample.end, '?');
      await expect(undo(page)).toBeDisabled();
    } else await undo(page).click();
  }
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
});
