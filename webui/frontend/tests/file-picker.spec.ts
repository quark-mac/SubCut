import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

const inputs = path.resolve('.test-workspace/inputs');

test('选择视频和字幕后解析并创建工程，无需手动输入路径', async ({ page }) => {
  await page.route('**/api/files/pick', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { path: path.join(inputs, body.kind === 'media' ? '短片.mp4' : '来源.srt') } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByRole('button', { name: '选择视频…', exact: true }).click();
  await expect(page.getByLabel('视频绝对路径', { exact: true })).toHaveValue(path.join(inputs, '短片.mp4'));
  await page.getByRole('button', { name: '选择字幕…', exact: true }).click();
  await expect(page.getByLabel('字幕绝对路径', { exact: true })).toHaveValue(path.join(inputs, '来源.srt'));
  await page.getByRole('button', { name: '解析预览', exact: true }).click();
  const created = page.waitForResponse(r => r.url().endsWith('/api/projects') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const project = await response.json();
  expect(project.media.path).toBe(path.join(inputs, '短片.mp4'));
  expect(project.subtitle_sources[0].path).toBe(path.join(inputs, '来源.srt'));
  await expect(page.getByRole('button', { name: '列表字幕 1', exact: true })).toBeVisible();
});

test('替换字幕选择中锁定操作，取消保留预览，失败可重试，重新选取使旧预览失效', async ({ page }) => {
  const original = await (await page.request.post('/api/projects', { data: {
    name: `文件选择替换-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: path.join(inputs, '来源.srt'),
  } })).json();
  const subtitle = path.join(inputs, '选择 中文 空格.jsonl');
  await fs.writeFile(subtitle, JSON.stringify({ idx: 1, start: 1, end: 2, speaker: '角色', text: '选择的新字幕' }));
  let release: (() => void) | undefined;
  let mode: 'select' | 'cancel' | 'error' = 'select';
  const requests: unknown[] = [];
  await page.route('**/api/files/pick', async route => {
    requests.push(route.request().postDataJSON());
    if (mode === 'cancel') await new Promise<void>(resolve => { release = resolve; });
    if (mode === 'error') await route.fulfill({ status: 503, json: { error: { message: '无法打开系统文件选择窗口' } } });
    else await route.fulfill({ json: { path: mode === 'cancel' ? null : subtitle } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name: original.name, exact: true }).click();
  await page.getByRole('button', { name: '替换字幕', exact: true }).click();
  await expect(page.getByRole('button', { name: '选择视频…' })).toBeDisabled();
  await page.getByLabel('导入格式').selectOption('normalized-jsonl');
  await page.getByRole('button', { name: '选择字幕…' }).click();
  await expect(page.getByLabel('字幕绝对路径', { exact: true })).toHaveValue(subtitle);
  expect(requests[0]).toEqual({ kind: 'subtitle', format: 'normalized-jsonl', current_path: '' });
  await page.getByRole('button', { name: '解析预览', exact: true }).click();
  const apply = page.getByRole('button', { name: '应用替换', exact: true });
  await expect(apply).toBeEnabled();
  mode = 'cancel';
  await page.getByRole('button', { name: '选择字幕…' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('系统文件选择窗口');
  for (const button of ['选择字幕…', '关闭对话框', '应用替换']) {
    await expect(page.getByRole('button', { name: button, exact: true })).toBeDisabled();
  }
  await expect(page.getByLabel('导入格式')).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release!();
  await expect(apply).toBeEnabled();
  await expect(page.getByLabel('字幕绝对路径', { exact: true })).toHaveValue(subtitle);
  mode = 'error';
  await page.getByRole('button', { name: '选择字幕…' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('无法打开系统文件选择窗口');
  await expect(apply).toBeEnabled();
  mode = 'select';
  await page.getByRole('button', { name: '选择字幕…' }).click();
  await expect(page.getByRole('button', { name: '选择字幕…' })).toBeEnabled();
  await expect(apply).toBeDisabled(); // Even reselecting the same path refreshes its contents.
  expect(await (await page.request.get(`/api/projects/${original.id}`)).json()).toEqual(original);
  await page.getByRole('button', { name: '解析预览', exact: true }).click();
  await apply.click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries).toHaveLength(1);
  expect(saved.entries[0].text).toBe('选择的新字幕');
  expect(saved.subtitle_sources[0].path).toBe(subtitle);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('button', { name: '列表字幕 3', exact: true })).toBeVisible();
});

test('重新定位与新视频副本可用文件选择，取消不会清空已有视频', async ({ page }) => {
  const original = await (await page.request.post('/api/projects', { data: {
    name: `文件选择视频-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: path.join(inputs, '来源.srt'),
  } })).json();
  let cancel = false;
  await page.route('**/api/files/pick', async route => {
    expect(route.request().postDataJSON().kind).toBe('media');
    await route.fulfill({ json: { path: cancel ? null : original.media.path } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name: original.name, exact: true }).click();
  for (const action of ['重新定位原片', '用新视频建立工程']) {
    await page.getByRole('button', { name: action, exact: true }).click();
    cancel = false;
    await page.getByRole('button', { name: '选择视频…' }).click();
    await expect(page.getByLabel('新视频绝对路径')).toHaveValue(original.media.path);
    cancel = true;
    await page.getByRole('button', { name: '选择视频…' }).click();
    await expect(page.getByRole('button', { name: '选择视频…' })).toBeEnabled();
    await expect(page.getByLabel('新视频绝对路径')).toHaveValue(original.media.path);
    await page.getByRole('button', { name: action === '重新定位原片' ? '验证并重新定位' : '创建独立副本', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(original.name + '-副本');
});
