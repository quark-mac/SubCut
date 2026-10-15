import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/api';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const row = (page: Page, n: number) => button(page, `列表字幕 ${n}`);
async function fixture(page: Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, '校对.jsonl');
  await fs.writeFile(subtitle, [
    { idx: 1, start: 1, end: 1.35, speaker: '甲', text: '目标短句\n第二行' },
    { idx: 2, start: 1.1, end: 2, speaker: '乙', text: '重叠台词' },
    { idx: 3, start: 3, end: 5, speaker: '甲', text: '目标长句' },
    { idx: 4, start: 6, end: 7, speaker: '乙', text: '另一条编辑' },
  ].map(e => JSON.stringify(e)).join('\n'));
  const response = await page.request.post('/api/projects', { data: { name: `校对-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl' } });
  expect(response.status()).toBe(201);
  const project: Project = await response.json();
  await page.goto('/');
  await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, project.name).click();
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4);
  return project;
}
const disk = async (page: Page, p: Project): Promise<Project> => (await page.request.get(`/api/projects/${p.id}`)).json();

test('逐句双击短句终点停止，轨道双击、慢放循环与明确退出，跳转同步', async ({ page }) => {
  const p = await fixture(page);
  await row(page, 1).dblclick();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 1.35);
  await page.getByLabel('播放速度').selectOption('0.5');
  await row(page, 1).click(); await button(page, '循环当前字幕').click();
  await expect(page.locator('video')).toHaveJSProperty('playbackRate', 0.5);
  await page.waitForTimeout(1800);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(1);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(1.4);
  await button(page, '退出试听').click();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await page.getByLabel('播放速度').selectOption('2');
  await button(page, '字幕总览：目标短句\n第二行').dblclick();
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 1.35);
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await page.getByLabel('跳转时间').fill('00:00:06.200'); await button(page, '跳转').click();
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 6.2);
  await expect(page.getByLabel('播放位置')).toContainText('00:00:06.200');
  await expect(row(page, 4)).toHaveClass(/active/);
  await expect(row(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('跳转时间').fill('00:70:00'); await button(page, '跳转').click();
  await expect(page.getByLabel('跳转时间')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('video')).toHaveJSProperty('currentTime', 6.2);
  await expect(button(page, '撤销')).toBeDisabled();
  expect(await disk(page, p)).toEqual(p);
});

test('搜索及人物筛选仅过滤呈现，不能把全体不连续项变成可合并项', async ({ page }) => {
  const p = await fixture(page);
  await page.getByLabel('搜索字幕').fill('目标');
  await expect(page.locator('.subtitle-row')).toHaveCount(2);
  await page.getByLabel('筛选说话人').selectOption(p.speakers.find(s => s.label === '甲')!.id);
  await row(page, 1).click(); await row(page, 3).click({ modifiers: ['Control'] });
  await expect(button(page, '合并字幕')).toBeDisabled();
  await page.keyboard.press('Control+m');
  await expect(button(page, '撤销')).toBeDisabled();
  expect(await disk(page, p)).toEqual(p);
  await page.getByLabel('搜索字幕').fill('没有结果');
  await expect(page.getByText('没有匹配字幕')).toBeVisible();
  await button(page, '清除筛选').click();
  await expect(page.locator('.subtitle-row')).toHaveCount(4);
  await expect(row(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 3)).toHaveAttribute('aria-pressed', 'true');
});

test('重叠多行工作字幕错位显示，姓名独立开关，草稿提交才更新叠加', async ({ page }) => {
  await fixture(page);
  await row(page, 1).click();
  await page.getByLabel('跳转时间').fill('1.2'); await button(page, '跳转').click();
  const overlay = page.getByLabel('播放字幕');
  await expect(overlay).toContainText('[甲]'); await expect(overlay).toContainText('[乙]');
  const blocks = overlay.locator(':scope > div');
  await expect(blocks).toHaveCount(2);
  const first = (await blocks.nth(0).boundingBox())!, second = (await blocks.nth(1).boundingBox())!;
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  await page.getByLabel('叠加人物名称').uncheck();
  await expect(overlay).not.toContainText('[甲]'); await expect(overlay).toContainText('第二行');
  await page.getByRole('checkbox', { name: '字幕', exact: true }).uncheck();
  await expect(overlay).toHaveCount(0);
  await page.getByRole('checkbox', { name: '字幕', exact: true }).check();
  await expect(overlay).not.toContainText('[甲]');
  await page.getByLabel('字幕正文').fill('已校对多行\n新第二行');
  await expect(overlay).toContainText('目标短句');
  await page.getByLabel('说话人名称', { exact: true }).fill('新甲');
  await button(page, '应用修改').click();
  await page.getByLabel('叠加人物名称').check();
  await expect(overlay).toContainText('[新甲] 已校对多行');
  await expect(row(page, 1)).toContainText('新第二行');
  await button(page, '撤销').click();
  await expect(overlay).toContainText('[甲] 目标短句');
  await expect(button(page, '撤销')).toBeDisabled();
});

test('循环高亮与另一条的编辑选择分离，输入焦点和提交不改变试听对象', async ({ page }) => {
  const p = await fixture(page);
  await row(page, 3).click(); await button(page, '循环当前字幕').click();
  await row(page, 4).click({ modifiers: ['Control'] }); await row(page, 3).click({ modifiers: ['Control'] });
  await expect(row(page, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 3)).toHaveClass(/active/);
  await page.getByLabel('字幕正文').fill('播放中编辑另一条');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space');
  await page.waitForTimeout(2300);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await expect(page.getByLabel('字幕正文')).toHaveValue('播放中编辑另一 条');
  await expect(row(page, 4)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('播放字幕')).toContainText('目标长句');
  await button(page, '应用修改').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const saved = await disk(page, p);
  expect(saved.entries.slice(0, 3)).toEqual(p.entries.slice(0, 3));
  expect(saved.entries[3].text).toBe('播放中编辑另一 条');
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await button(page, '退出试听').click();
  await row(page, 4).focus(); await page.keyboard.press('ArrowLeft');
  await expect(row(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space'); await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.keyboard.press('Space'); await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await page.keyboard.press('Escape'); await expect(row(page, 3)).toHaveAttribute('aria-pressed', 'false');
});

test('三面板与上下分区拖动可用，取消恢复，视图复位不写历史', async ({ page }) => {
  const p = await fixture(page);
  const resources = page.getByRole('complementary', { name: '工程资源' });
  const editor = page.getByRole('region', { name: '字幕编辑器' });
  const timeline = page.getByRole('region', { name: '原片时间轴', exact: true });
  const before = { left: (await resources.boundingBox())!.width, right: (await editor.boundingBox())!.width, bottom: (await timeline.boundingBox())!.height };
  async function drag(name: string, dx: number, dy: number, cancel = false) {
    const handle = page.getByRole('separator', { name }); const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  await drag('调整资源面板宽度', 60, 0);
  expect((await resources.boundingBox())!.width).toBeCloseTo(before.left + 60, 0);
  await drag('调整编辑面板宽度', -50, 0);
  expect((await editor.boundingBox())!.width).toBeCloseTo(before.right + 50, 0);
  await drag('调整上下分区高度', 0, -70);
  expect((await timeline.boundingBox())!.height).toBeCloseTo(before.bottom + 70, 0);
  await drag('调整上下分区高度', 0, 50, true);
  expect((await timeline.boundingBox())!.height).toBeCloseTo(before.bottom + 70, 0);
  await button(page, '视图').click(); await button(page, '重置面板布局').click();
  expect((await resources.boundingBox())!.width).toBeCloseTo(before.left, 0);
  expect((await timeline.boundingBox())!.height).toBeCloseTo(before.bottom, 0);
  await page.setViewportSize({ width: 1100, height: 800 });
  await row(page, 1).click();
  await expect(button(page, '循环当前字幕')).toBeInViewport();
  await expect(page.locator('.timeline-toolbar').getByRole('button', { name: '撤销', exact: true })).toBeInViewport();
  await expect(page.getByLabel('搜索字幕')).toBeInViewport();
  await expect(page.locator('video')).toBeInViewport();
  await expect(button(page, '撤销')).toBeDisabled(); expect(await disk(page, p)).toEqual(p);
});

test('帮助列出全部已交付快捷键，文件编辑视图菜单执行真实操作', async ({ page }) => {
  const p = await fixture(page);
  await button(page, '帮助').click();
  const help = page.getByRole('dialog');
  for (const key of ['↑ / ↓', '← / →', '空格', 'Delete', 'Ctrl+B', 'Ctrl+M', 'Ctrl+S', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Esc']) await expect(help).toContainText(key);
  await page.keyboard.press('Escape'); await expect(help).toHaveCount(0);
  await row(page, 1).click(); await button(page, '编辑').click(); await button(page, '编辑字幕正文').click();
  await expect(page.getByLabel('字幕正文')).toBeFocused();
  await page.getByLabel('字幕正文').fill('通过菜单修改'); await button(page, '应用修改').click();
  await button(page, '编辑').click(); await button(page, '撤销编辑').click();
  await expect(row(page, 1)).toContainText('目标短句');
  await button(page, '编辑').click(); await button(page, '重做编辑').click();
  await expect(row(page, 1)).toContainText('通过菜单修改');
  await button(page, '视图').click(); await button(page, '说话人管理页签').click();
  await expect(page.getByRole('tab', { name: '说话人', exact: true })).toHaveAttribute('aria-selected', 'true');
  await button(page, '视图').click(); await button(page, '字幕编辑页签').click();
  await button(page, '视图').click(); await button(page, '显示工作字幕').click();
  await expect(page.getByLabel('播放字幕')).toHaveCount(0);
  await button(page, '视图').click(); await button(page, '显示工作字幕').click();
  await expect(page.getByLabel('播放字幕')).toContainText('通过菜单修改');
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  await button(page, '文件').click(); await button(page, '导出当前字幕').click();
  await expect.poll(async () => (await disk(page, p)).exports.length).toBe(1);
  const saved = await disk(page, p);
  const output = await page.request.get(`/api/projects/${p.id}/exports/${saved.exports[0].id}`);
  expect(await output.text()).toContain('[甲] 通过菜单修改');
  await button(page, '文件').click(); await button(page, '替换工作字幕…').click();
  await expect(page.getByRole('dialog')).toContainText('整体替换工作字幕');
  await button(page, '关闭对话框').click();
});

test('片尾循环可退出，删除当前试听目标后停止，不把恢复的字幕自动重新播放', async ({ page }) => {
  const p = await fixture(page);
  await row(page, 4).click();
  await page.getByLabel('开始时间（毫秒）').fill('7700');
  await page.getByLabel('结束时间（毫秒）').fill('8000');
  await button(page, '应用修改').click();
  await button(page, '循环当前字幕').click();
  await page.waitForTimeout(1100);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(7.7);
  await button(page, '删除选中字幕').click();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await expect(page.getByLabel('试听状态')).toHaveText('自由播放');
  await expect(button(page, '退出试听')).toBeDisabled();
  await button(page, '撤销').click();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  expect((await disk(page, p)).entries[3]).toEqual({ ...p.entries[3], start_ms: 7700, end_ms: 8000 });
});
