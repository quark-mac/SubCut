import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

async function openFixture(page: import('@playwright/test').Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const response = await page.request.post('/api/projects', { data: {
    name: `校验-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: path.join(inputs, '来源.srt'),
  } });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto('/');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
  return project;
}

test('普通 SRT 从预览、原片播放、正文校对到保存重开和真实文件导出', async ({ page }) => {
  const inputs = path.resolve('.test-workspace/inputs');
  const source = await fs.readFile(path.join(inputs, '来源.srt'), 'utf8');
  const name = `浏览器校对-${Date.now()}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByLabel('工程名称').fill(name);
  await page.getByLabel('视频绝对路径').fill(path.join(inputs, '短片.mp4'));
  await page.getByLabel('普通 SRT 绝对路径').fill(path.join(inputs, '来源.srt'));
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog').getByText('[不是人物] 原样保留：正文\n第二行', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1, 1);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1.2);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByLabel('字幕正文').fill('浏览器修改\n第二行保留');
  await page.getByLabel('开始时间（毫秒）').fill('1200');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  await page.reload();
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  // The edited item now sorts after the unchanged overlapping entry.
  await page.getByRole('button', { name: '列表字幕 2', exact: true }).click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('浏览器修改\n第二行保留');
  await expect(page.getByLabel('开始时间（毫秒）')).toHaveValue('1200');
  // Export must commit a focused editor, not silently use the last saved text.
  await page.getByLabel('字幕正文').fill('导出时提交\n第二行保留');
  const exportedResponse = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '导出普通 SRT', exact: true }).click();
  const result = await (await exportedResponse).json();
  await expect(page.getByRole('link', { name: result.export.filename })).toBeVisible();
  const output = await fs.readFile(result.export.path, 'utf8');
  expect(output).toBe('1\n00:00:01,000 --> 00:00:04,000\n同时出现\n\n2\n00:00:01,200 --> 00:00:04,000\n导出时提交\n第二行保留\n\n3\n00:00:03,000 --> 00:00:05,000\n稍后的字幕\n');
  expect(await fs.readFile(path.join(inputs, '来源.srt'), 'utf8')).toBe(source);
  expect(errors).toEqual([]);
});

test('重复选择正在编辑的字幕会保留刚提交的正文，并同步总览与人物轨', async ({ page }) => {
  await openFixture(page);
  await page.getByLabel('字幕正文').fill('重复选择后的正文');
  await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('重复选择后的正文');
  await expect(page.getByRole('button', { name: '字幕总览：重复选择后的正文', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '未标注 ?：重复选择后的正文', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
});

test('非法输入阻止保存和导出，保存失败保留输入并可重试', async ({ page }) => {
  const project = await openFixture(page);
  const editor = page.getByLabel('字幕正文');
  await editor.fill('   ');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('字幕正文不能为空');
  await expect(editor).toBeFocused();
  await editor.fill('修正后正文');
  await page.getByLabel('结束时间（毫秒）').fill('9000');
  await page.getByRole('button', { name: '导出普通 SRT', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('不超过原片时长');
  await expect(page.getByLabel('结束时间（毫秒）')).toBeFocused();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).exports).toEqual([]);
  await page.getByLabel('结束时间（毫秒）').fill('4000');
  // Simulate a network/storage failure at the public HTTP boundary, once.
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 500, json: { error: { message: '测试磁盘写入失败' } } });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('保存失败');
  await expect(editor).toHaveValue('修正后正文');
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).revision).toBe(1);
  await page.unroute(`**/api/projects/${project.id}`);
  await editor.press('Control+s');
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(saved.entries[1].text).toBe('修正后正文');
});
