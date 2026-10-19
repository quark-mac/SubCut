import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/api';

async function open(page: Page, name: string) {
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function fixture(page: Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, '多选.jsonl');
  await fs.writeFile(subtitle, [
    { idx: 11, start: 1, end: 2, speaker: '甲', text: '第一句', tags: ['MULTI'], source_entries: [9, 9, 2] },
    { idx: 12, start: 1, end: 2, speaker: '甲', text: '同时间重叠' },
    { idx: 13, start: 2.5, end: 4, speaker: '乙', text: '第二人' },
    { idx: 14, start: 5, end: 6, speaker: '丙', text: '第三人' },
    { idx: 15, start: 7, end: 8, speaker: 'NONSPEECH', text: '风声' },
  ].map(row => JSON.stringify(row)).join('\n'));
  const response = await page.request.post('/api/projects', { data: {
    name: `多选-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl',
  } });
  expect(response.status()).toBe(201);
  const project: Project = await response.json();
  await page.goto('/');
  await open(page, project.name);
  return project;
}

const clip = (page: Page, text = '第一句', track = '字幕总览') => page.getByRole('button', { name: `${track}：${text}`, exact: true });
const row = (page: Page, index: number) => page.getByRole('button', { name: `列表字幕 ${index}`, exact: true });
const undo = (page: Page) => page.getByRole('button', { name: '撤销', exact: true });
const redo = (page: Page) => page.getByRole('button', { name: '重做', exact: true });
const saved = async (page: Page, project: Project): Promise<Project> => (await page.request.get(`/api/projects/${project.id}`)).json();

test('Ctrl 跨视图切换同一身份，Shift 按稳定时间顺序连选，修饰键不暂停或定位', async ({ page }) => {
  const project = await fixture(page);
  await clip(page).click();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 1);
  await row(page, 3).click({ modifiers: ['Control'] });
  await expect(row(page, 1)).toHaveClass(/selected/);
  await expect(row(page, 3)).toHaveClass(/selected/);
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 1);
  await clip(page, '第一句', '甲').click({ modifiers: ['Control'] });
  await expect(row(page, 1)).not.toHaveClass(/selected/);
  await expect(row(page, 3)).toHaveClass(/selected/);
  await row(page, 1).click();
  await row(page, 3).click({ modifiers: ['Shift'] });
  await expect(page.locator('.subtitle-row.selected')).toHaveCount(3);
  await expect(clip(page, '同时间重叠', '甲')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const before = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
  await clip(page, '第三人').click({ modifiers: ['Control'] });
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  const after = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after).toBeLessThan(before + 2);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(undo(page)).toBeDisabled();
  expect(await saved(page, project)).toEqual(project);
  await page.keyboard.press('Escape');
  await expect(page.locator('.subtitle-row.selected')).toHaveCount(0);
});

async function boxFirstPair(page: Page) {
  const first = clip(page);
  await first.hover();
  const r = (await first.boundingBox())!;
  await page.mouse.move(r.x - 20, r.y - 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width + 12, r.y + 65, { steps: 8 });
  await page.mouse.wheel(0, 90);
  await expect.poll(() => page.getByRole('region', { name: '时间轴轨道滚动区' }).evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const same = (await clip(page, '同时间重叠', '甲').boundingBox())!;
  await page.mouse.move(r.x + r.width + 12, same.y + same.height + 3, { steps: 8 });
}

test('空白框选跨总览人物轨按 ID 去重，播放继续，Esc 恢复手势前选择且无历史', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await boxFirstPair(page);
  await page.mouse.up();
  await expect(page.locator('.subtitle-row.selected')).toHaveCount(2);
  await expect(clip(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(clip(page, '第一句', '甲')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(4);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await row(page, 4).click({ modifiers: ['Control'] });
  await boxFirstPair(page);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.subtitle-row.selected')).toHaveCount(3);
  await expect(row(page, 4)).toHaveClass(/selected/);
  await expect(undo(page)).toBeDisabled();
  expect(await saved(page, project)).toEqual(project);
});

async function settled(page: Page, project: Project) {
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  return saved(page, project);
}

test('共同与混合属性如实呈现，明确目标批量改人仅一步历史并保存重开', async ({ page }) => {
  const project = await fixture(page);
  await boxFirstPair(page);
  await page.mouse.up();
  await expect(page.getByLabel('选择数量')).toHaveText('已选 2 条');
  await expect(page.getByLabel('共同正文')).toHaveText('不同值');
  await expect(page.getByLabel('共同开始时间')).toHaveText('1000 ms');
  await expect(page.getByLabel('共同结束时间')).toHaveText('2000 ms');
  await expect(page.getByLabel('共同说话人')).toHaveText('甲');
  await row(page, 3).click({ modifiers: ['Control'] });
  await expect(page.getByLabel('共同开始时间')).toHaveText('不同值');
  await expect(page.getByLabel('共同结束时间')).toHaveText('不同值');
  await expect(page.getByLabel('共同说话人')).toHaveText('不同值');
  await expect(page.getByRole('button', { name: '应用批量归属' })).toBeDisabled();
  await page.getByLabel('批量说话人归属', { exact: true }).selectOption('丙');
  expect(await saved(page, project)).toEqual(project); // Choosing a target alone is not submission.
  await page.getByRole('button', { name: '应用批量归属' }).click();
  await expect(page.getByLabel('共同说话人')).toHaveText('丙');
  const result = await settled(page, project);
  expect(result.entries).toEqual(project.entries.map((e, i) => i < 3 ? { ...e, speaker_id: project.speakers[2].id } : e));
  expect(result.speakers).toEqual(project.speakers);
  await undo(page).click();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  expect((await settled(page, project)).entries).toEqual(result.entries);
  await page.reload();
  await open(page, project.name);
  expect((await saved(page, project)).entries).toEqual(result.entries);
  await expect(undo(page)).toBeDisabled();
});

test('多选上下键使用重排后的轨序保持间距，任一越界全拒绝且不破坏重做', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  const card = (label: string) => page.getByRole('group', { name: `说话人 ${label}`, exact: true });
  await card('乙').getByRole('button', { name: '拖动排序 乙' }).dragTo(card('甲'));
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨', '字幕总览', '乙', '甲', '丙', '未标注 ?', '非对白 NONSPEECH']);
  await clip(page).click();
  await row(page, 3).click({ modifiers: ['Control'] });
  await page.keyboard.press('ArrowUp'); // 乙 is now first: the whole action must be rejected.
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await page.keyboard.press('ArrowDown');
  const changed = project.entries.map((e, i) => i === 0 ? { ...e, speaker_id: project.speakers[2].id } : i === 2 ? { ...e, speaker_id: project.speakers[0].id } : e);
  expect((await settled(page, project)).entries).toEqual(changed);
  await undo(page).click();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await row(page, 1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  expect((await settled(page, project)).entries).toEqual(changed);
  await undo(page).click();
  await undo(page).click(); // One reorder step, one batch step.
  await expect(undo(page)).toBeDisabled();
  await row(page, 1).focus();
  await page.keyboard.press('ArrowDown');
  expect((await settled(page, project)).entries).toEqual(project.entries.map((e, i) => i === 0 ? { ...e, speaker_id: project.speakers[1].id } : i === 2 ? { ...e, speaker_id: project.speakers[2].id } : e));
  await expect(redo(page)).toBeDisabled();
  await row(page, 5).click({ modifiers: ['Control'] });
  const before = await settled(page, project);
  await page.keyboard.press('ArrowDown'); // Bottom special track prevents every selected change.
  expect(await settled(page, project)).toEqual(before);
  await undo(page).click();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(undo(page)).toBeDisabled();
});

test('Delete 单选多选各一步，输入焦点优先文字，Esc 清选择与撤销恢复完整身份来源', async ({ page }) => {
  const project = await fixture(page);
  await clip(page).click();
  const text = page.getByLabel('字幕正文');
  await text.focus();
  await text.press('Home');
  await text.press('Delete');
  await expect(text).toHaveValue('一句');
  expect((await saved(page, project)).entries).toEqual(project.entries);
  await text.press('Escape');
  await expect(text).toHaveValue('第一句');
  await expect(undo(page)).toBeDisabled();
  await row(page, 1).focus();
  await page.keyboard.press('Delete');
  expect((await settled(page, project)).entries).toEqual(project.entries.slice(1));
  await undo(page).click();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(undo(page)).toBeDisabled();
  await clip(page).click();
  await row(page, 3).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Escape');
  await expect(page.locator('.subtitle-row.selected')).toHaveCount(0);
  await page.keyboard.press('Delete');
  await expect(redo(page)).toBeEnabled();
  await clip(page).click();
  await row(page, 3).click({ modifiers: ['Shift'] });
  await page.getByLabel('批量说话人归属', { exact: true }).focus();
  await page.keyboard.press('Delete');
  expect((await saved(page, project)).entries).toEqual(project.entries);
  await row(page, 1).focus();
  await page.keyboard.press('Delete');
  const deleted = await settled(page, project);
  expect(deleted.entries).toEqual(project.entries.slice(3));
  expect(deleted.speakers).toEqual(project.speakers);
  expect(deleted.subtitle_sources).toEqual(project.subtitle_sources);
  await undo(page).click();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  expect((await settled(page, project)).entries).toEqual(deleted.entries);
  await page.reload();
  await open(page, project.name);
  await expect(page.locator('.subtitle-row')).toHaveCount(2);
  expect((await saved(page, project)).entries).toEqual(deleted.entries);
  await expect(undo(page)).toBeDisabled();
});

async function beginDrag(page: Page, delta: number, track = '字幕总览') {
  const target = clip(page, '第一句', track);
  await target.hover();
  const rect = (await target.boundingBox())!;
  const ruler = (await page.getByLabel('原片时间刻度', { exact: true }).boundingBox())!;
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta / 8000 * ruler.width, y, { steps: 8 });
  return { x: x + delta / 8000 * ruler.width, y };
}

test('多选横拖整体夹取片头片尾保持相对时间时长，预览不落盘，一步历史', async ({ page }) => {
  const project = await fixture(page);
  await clip(page).click();
  await row(page, 3).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: '吸附', exact: true }).click();
  for (const sample of [
    { delta: 500, first: [1500, 2500], second: [3000, 4500] },
    { delta: -3000, first: [0, 1000], second: [1500, 3000] },
    { delta: 9000, first: [5000, 6000], second: [6500, 8000] },
  ]) {
    await beginDrag(page, sample.delta);
    await expect(page.getByLabel('选择数量')).toHaveText('已选 2 条');
    await expect(clip(page)).toHaveAttribute('title', new RegExp(`00:00:0${sample.first[0] / 1000}`));
    await page.waitForTimeout(750);
    expect((await saved(page, project)).entries).toEqual(project.entries);
    await page.mouse.up();
    const expected = project.entries.map((e, i) => i === 0 ? { ...e, start_ms: sample.first[0], end_ms: sample.first[1] } : i === 2 ? { ...e, start_ms: sample.second[0], end_ms: sample.second[1] } : e);
    expect((await settled(page, project)).entries).toEqual(expected);
    await undo(page).click();
    expect((await settled(page, project)).entries).toEqual(project.entries);
    await expect(undo(page)).toBeDisabled();
    await redo(page).click();
    expect((await settled(page, project)).entries).toEqual(expected);
    await undo(page).click();
    await settled(page, project);
  }
});

async function toTrack(page: Page, label: string, x: number) {
  const target = page.locator('.track-label').filter({ hasText: new RegExp(`^${label}$`) });
  await target.scrollIntoViewIfNeeded();
  const rect = (await target.boundingBox())!;
  await page.mouse.move(x, rect.y + rect.height / 2, { steps: 8 });
}

test('多选纵斜拖保持轨道间距，越界连同时间全拒绝，Esc 取消保留重做，重开一致', async ({ page }) => {
  const project = await fixture(page);
  await clip(page).click();
  await row(page, 3).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: '吸附', exact: true }).click();
  for (const delta of [0, 500]) {
    const pointer = await beginDrag(page, delta);
    await toTrack(page, '乙', pointer.x);
    await page.mouse.up();
    const expected = project.entries.map((e, i) => i === 0 ? { ...e, start_ms: 1000 + delta, end_ms: 2000 + delta, speaker_id: project.speakers[1].id } : i === 2 ? { ...e, start_ms: 2500 + delta, end_ms: 4000 + delta, speaker_id: project.speakers[2].id } : e);
    expect((await settled(page, project)).entries).toEqual(expected);
    await undo(page).click();
    expect((await settled(page, project)).entries).toEqual(project.entries);
    await expect(undo(page)).toBeDisabled();
  }
  const invalid = await beginDrag(page, 500);
  await toTrack(page, '非对白 NONSPEECH', invalid.x);
  await page.mouse.up();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  const cancel = await beginDrag(page, 250);
  await toTrack(page, '丙', cancel.x);
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(750);
  expect((await saved(page, project)).entries).toEqual(project.entries);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByLabel('选择数量')).toHaveText('已选 2 条');
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  const final = await settled(page, project);
  expect(final.entries).toEqual(project.entries.map((e, i) => i === 0 ? { ...e, start_ms: 1500, end_ms: 2500, speaker_id: project.speakers[1].id } : i === 2 ? { ...e, start_ms: 3000, end_ms: 4500, speaker_id: project.speakers[2].id } : e));
  await page.screenshot({ path: '../tests/evidence/ticket-07-batch-editing.jpg', type: 'jpeg', quality: 85, fullPage: true });
  await page.reload();
  await open(page, project.name);
  expect((await saved(page, project)).entries).toEqual(final.entries);
  await expect(undo(page)).toBeDisabled();
});

test('无效正文阻止修饰键选择并保留错误焦点，取消后可继续多选', async ({ page }) => {
  const project = await fixture(page);
  await clip(page).click();
  await page.getByLabel('字幕正文').fill('');
  await clip(page, '第二人').click({ modifiers: ['Control'] });
  await expect(page.getByLabel('字幕正文')).toBeFocused();
  await expect(page.getByLabel('字幕正文')).toHaveAttribute('aria-invalid', 'true');
  await expect(row(page, 1)).toHaveClass(/selected/);
  await expect(row(page, 3)).not.toHaveClass(/selected/);
  expect(await saved(page, project)).toEqual(project);
  await page.keyboard.press('Escape');
  await clip(page, '第二人').click({ modifiers: ['Control'] });
  await expect(page.getByLabel('选择数量')).toHaveText('已选 2 条');
  await expect(undo(page)).toBeDisabled();
});

test('撤销整体替换清除失效的多选身份，继续选择不会出现幽灵条目', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('button', { name: '替换字幕', exact: true }).click();
  await page.getByLabel('导入格式').selectOption('normalized-jsonl');
  await page.getByLabel('字幕绝对路径').fill(path.resolve('.test-workspace/inputs/多选.jsonl'));
  await page.getByRole('button', { name: '解析预览' }).click();
  await page.getByRole('button', { name: '应用替换' }).click();
  await clip(page).click();
  await row(page, 3).click({ modifiers: ['Shift'] });
  await expect(page.getByLabel('选择数量')).toHaveText('已选 3 条');
  await undo(page).click();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(page.getByLabel('选择数量')).toHaveCount(0);
  await row(page, 1).click({ modifiers: ['Control'] });
  await expect(page.getByLabel('字幕正文')).toHaveValue('第一句');
  await expect(page.locator('.subtitle-row.selected')).toHaveCount(1);
  await expect(redo(page)).toBeEnabled();
});

test('双视图框选在 2× 吸附移动只改每条一次，取消和空目标不写历史', async ({ page }) => {
  const project = await fixture(page);
  await page.getByLabel('时间轴缩放', { exact: true }).focus();
  await page.getByLabel('时间轴缩放', { exact: true }).fill('1');
  await expect(page.getByLabel('缩放倍率')).toHaveText('2×');
  const viewport = page.getByRole('region', { name: '时间轴轨道滚动区' });
  await viewport.hover();
  await page.mouse.wheel(-10000, 0);
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBe(0);
  await boxFirstPair(page);
  await page.mouse.up();
  await expect(page.getByLabel('选择数量')).toHaveText('已选 2 条');
  await beginDrag(page, 480);
  await page.mouse.up();
  const expected = project.entries.map((e, i) => i < 2 ? { ...e, start_ms: 1500, end_ms: 2500 } : e);
  expect((await settled(page, project)).entries).toEqual(expected);
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  const noOp = await beginDrag(page, 0, '甲');
  await toTrack(page, '字幕总览', noOp.x);
  await page.mouse.up();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeEnabled();
  await page.getByRole('button', { name: '吸附', exact: true }).click();
  await beginDrag(page, 125);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await settled(page, project)).entries).toEqual(project.entries);
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  expect((await settled(page, project)).entries).toEqual(expected);
});

test('人物重排后的多选鼠标偏移使用当前顺序，边缘批量调整夹取共同合法范围', async ({ page }) => {
  const project = await fixture(page);
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  const card = (label: string) => page.getByRole('group', { name: `说话人 ${label}`, exact: true });
  await card('乙').getByRole('button', { name: '拖动排序 乙' }).dragTo(card('甲'));
  await clip(page).click();
  await row(page, 3).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: '吸附', exact: true }).click();
  const pointer = await beginDrag(page, 500, '甲');
  await toTrack(page, '丙', pointer.x);
  await page.mouse.up();
  expect((await settled(page, project)).entries).toEqual(project.entries.map((e, i) => i === 0 ? { ...e, start_ms: 1500, end_ms: 2500, speaker_id: project.speakers[2].id } : i === 2 ? { ...e, start_ms: 3000, end_ms: 4500, speaker_id: project.speakers[0].id } : e));
  await undo(page).click();
  await undo(page).click();
  await expect(undo(page)).toBeDisabled();
  for (const sample of [
    { edge: '开始边界', delta: 3000, first: [1999, 2000], second: [3499, 4000] },
    { edge: '结束边界', delta: -3000, first: [1000, 1001], second: [2500, 3001] },
  ]) {
    const edge = clip(page).getByLabel(sample.edge, { exact: true });
    await edge.hover();
    const rect = (await edge.boundingBox())!;
    const ruler = (await page.getByLabel('原片时间刻度', { exact: true }).boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + sample.delta / 8000 * ruler.width, rect.y + rect.height / 2, { steps: 8 });
    await page.mouse.up();
    expect((await settled(page, project)).entries).toEqual(project.entries.map((e, i) => i === 0 ? { ...e, start_ms: sample.first[0], end_ms: sample.first[1] } : i === 2 ? { ...e, start_ms: sample.second[0], end_ms: sample.second[1] } : e));
    await undo(page).click();
    expect((await settled(page, project)).entries).toEqual(project.entries);
    await expect(undo(page)).toBeDisabled();
  }
});
