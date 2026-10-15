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

test('连续正文、时间及开放人物归属逐步撤销重做，保存保留历史，重开重置历史', async ({ page }) => {
  const project = await openFixture(page);
  const editor = page.getByLabel('字幕正文');
  const original = await editor.inputValue();
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const redo = page.getByRole('button', { name: '重做', exact: true });
  await expect(undo).toBeDisabled();
  await editor.fill('');
  await editor.pressSequentially('连续输入的一整句');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.getByLabel('开始时间（毫秒）').fill('1200');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.getByLabel('说话人名称').fill('Iroha&Kaguya');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Iroha&Kaguya：连续输入的一整句', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(saved.entries[1].id).toBe(project.entries[1].id);
  expect(saved.entries[1].sources).toEqual(project.entries[1].sources);
  expect(saved.entries[2]).toEqual(project.entries[2]);
  const person = saved.speakers.find((s: { label: string }) => s.label === 'Iroha&Kaguya');
  expect(saved.entries[1].speaker_id).toBe(person.id);
  await undo.click();
  await expect(page.getByLabel('说话人名称')).toHaveValue('?');
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('开始时间（毫秒）')).toHaveValue('1000');
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveValue(original);
  await expect(undo).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(editor).toHaveValue('连续输入的一整句');
  await redo.click();
  await redo.click();
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const restored = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(restored.entries).toEqual(saved.entries);
  expect(restored.speakers).toEqual(saved.speakers);
  await page.reload();
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
});

test('离开编辑区提交并自动保存，保存期间仍可编辑且旧响应不能确认新草稿', async ({ page }) => {
  const project = await openFixture(page);
  const status = page.getByRole('status', { name: '保存状态' });
  const editor = page.getByLabel('字幕正文');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let received = false;
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch(); // Actual server has written the first snapshot.
    received = true;
    await gate;
    await route.fulfill({ response });
  });
  await editor.fill('第一版自动落盘');
  await page.getByRole('heading', { name: '时间轴', exact: true }).click();
  await expect.poll(() => received).toBe(true);
  await expect(status).toHaveText('保存中…');
  await expect(editor).toBeEnabled();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries[1].text).toBe('第一版自动落盘');
  await editor.fill('较新但仍在输入的草稿');
  release();
  await expect(status).toHaveText('未保存');
  await expect(editor).toHaveValue('较新但仍在输入的草稿');
  await page.unroute(`**/api/projects/${project.id}`);
  await editor.press('Control+s');
  await expect(status).toHaveText('已保存');
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries[1].text).toBe('较新但仍在输入的草稿');
});

test('文字快捷键保留焦点语义，非法和取消输入不进入历史，分支编辑清除重做', async ({ page }) => {
  const project = await openFixture(page);
  const editor = page.getByLabel('字幕正文');
  const original = await editor.inputValue();
  const undo = page.getByRole('button', { name: '撤销', exact: true });
  const redo = page.getByRole('button', { name: '重做', exact: true });
  await editor.fill('第一步');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await editor.focus();
  await editor.press('End');
  await editor.pressSequentially('x');
  await editor.press('Control+z');
  await expect(editor).toHaveValue('第一步'); // Native text undo, not project undo.
  await editor.press('ArrowLeft');
  await editor.press('ArrowRight');
  await editor.press('ArrowUp');
  await editor.press('ArrowDown');
  await editor.press('Space');
  await editor.press('Backspace');
  await editor.press('Delete');
  await expect(page.getByRole('button', { name: '列表字幕 1', exact: true })).toContainText('第一步');
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await editor.fill('取消本次输入');
  await editor.press('Escape');
  await expect(editor).toHaveValue('第一步');
  await undo.click();
  await expect(editor).toHaveValue(original);
  await editor.fill('');
  await editor.press('Control+s');
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await expect(editor).toBeFocused();
  await expect(page.getByText('字幕正文不能为空', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await editor.fill('');
  await editor.press('Control+s');
  await editor.fill(original);
  await editor.press('Control+s');
  await expect(editor).toHaveAttribute('aria-invalid', 'false');
  await expect(redo).toBeEnabled(); // Returning to the same value is not an edit.
  await page.getByLabel('结束时间（毫秒）').fill('1000');
  await page.getByRole('button', { name: '导出普通 SRT', exact: true }).click();
  await expect(page.locator('[aria-invalid="true"]')).toBeFocused();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).exports).toEqual([]);
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  await redo.click();
  await expect(editor).toHaveValue('第一步');
  await undo.click();
  await editor.fill('新分支');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await expect(redo).toBeDisabled();
  await page.getByLabel('说话人归属').selectOption('NONSPEECH');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '非对白 NONSPEECH：新分支', exact: true })).toBeVisible();
  await page.getByLabel('说话人归属').selectOption('?');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '未标注 ?：新分支', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
});

test('服务已落盘但响应丢失后，继续编辑并重试能恢复最新版本', async ({ page }) => {
  const project = await openFixture(page);
  const url = `/api/projects/${project.id}`;
  const editor = page.getByLabel('字幕正文');
  const status = page.getByRole('status', { name: '保存状态' });
  await page.route(`**${url}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    await route.fetch();
    await route.abort('connectionreset');
  });
  await editor.fill('已落盘但回执丢失');
  await editor.press('Control+s');
  await expect(status).toHaveText('保存失败');
  expect((await (await page.request.get(url)).json()).entries[1].text).toBe('已落盘但回执丢失');
  await expect(editor).toBeEnabled();
  await page.unroute(`**${url}`);
  await editor.fill('恢复连接后的最新修改');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(status).toHaveText('已保存');
  const saved = await (await page.request.get(url)).json();
  expect(saved.entries[1].text).toBe('恢复连接后的最新修改');
  expect(saved.revision).toBe(3);
  await page.reload();
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
  await expect(editor).toHaveValue('恢复连接后的最新修改');
});

test('延迟保存回执串行处理，较新编辑不被覆盖，导出固定触发时快照', async ({ page }) => {
  const project = await openFixture(page);
  const url = `/api/projects/${project.id}`;
  const editor = page.getByLabel('字幕正文');
  const status = page.getByRole('status', { name: '保存状态' });
  let releaseFirst!: () => void, releaseSecond!: () => void;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  const writes: string[] = [];
  await page.route(`**${url}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    writes.push(route.request().postDataJSON().entries[1].text);
    if (writes.length === 1) await first;
    else if (writes.length === 2) await second;
    await route.fulfill({ response });
  });
  try {
    await editor.fill('A：较早自动保存');
    await page.getByRole('button', { name: '应用修改', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    await editor.fill('B：本次导出快照');
    const exported = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '导出普通 SRT', exact: true }).click();
    await editor.fill('C：导出后的最新编辑');
    await editor.press('Control+s');
    expect(writes).toEqual(['A：较早自动保存']);
    await expect(status).toHaveText('保存中…');
    releaseFirst();
    await expect.poll(() => writes.length).toBe(2);
    await expect(editor).toHaveValue('C：导出后的最新编辑');
    await expect(page.getByRole('button', { name: '字幕总览：C：导出后的最新编辑', exact: true })).toBeVisible();
    await expect(status).toHaveText('保存中…');
    expect((await (await page.request.get(url)).json()).entries[1].text).toBe('B：本次导出快照');
    releaseSecond();
    const output = await (await exported).json();
    const file = await fs.readFile(output.export.path, 'utf8');
    expect(file).toContain('B：本次导出快照');
    expect(file).not.toContain('C：导出后的最新编辑');
    await expect(status).toHaveText('已保存');
    expect(writes).toEqual(['A：较早自动保存', 'B：本次导出快照', 'C：导出后的最新编辑']);
    const saved = await (await page.request.get(url)).json();
    expect(saved.entries[1].text).toBe('C：导出后的最新编辑');
    expect(saved.exports).toHaveLength(1);
    expect(saved.revision).toBe(5);
  } finally { releaseFirst(); releaseSecond(); }
});

test('外部修订冲突明确提示且保留当前编辑，不覆盖磁盘新版本', async ({ page }) => {
  const project = await openFixture(page);
  const url = `/api/projects/${project.id}`;
  const external = structuredClone(project);
  external.entries[1].text = '另一个窗口的更新';
  const response = await page.request.put(url, { data: { revision: 1, name: project.name, entries: external.entries } });
  expect(response.ok()).toBeTruthy();
  await page.getByLabel('字幕正文').fill('本窗口仍然保留的编辑');
  await page.getByLabel('字幕正文').press('Control+s');
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('保存失败');
  await expect(page.getByRole('alert')).toContainText('工程已被更新');
  await expect(page.getByLabel('字幕正文')).toHaveValue('本窗口仍然保留的编辑');
  expect((await (await page.request.get(url)).json()).entries[1].text).toBe('另一个窗口的更新');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('保存失败');
  expect((await (await page.request.get(url)).json()).revision).toBe(2);
});

test('确认放弃未保存修改后切换工程，旧自动保存计时器不会随后写回', async ({ page }) => {
  const project = await openFixture(page);
  const writes: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes.push('PUT');
    await gate;
    await route.continue();
  });
  try {
    await page.getByLabel('字幕正文').fill('将被放弃的修改');
    await page.getByRole('button', { name: '应用修改', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '文件', exact: true }).click();
    await page.getByRole('button', { name: '打开工程…' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Wait beyond the documented 650 ms debounce to detect an unwanted write.
    await page.waitForTimeout(900);
    expect(writes).toEqual([]);
    await page.getByRole('button', { name: project.name, exact: true }).click();
    await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
    await expect(page.getByLabel('字幕正文')).toHaveValue(project.entries[1].text);
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).revision).toBe(1);
  } finally { release(); }
});

test('导出失败与工程保存状态区分，重试导出仍使用有效输入', async ({ page }) => {
  const project = await openFixture(page);
  const url = `**/api/projects/${project.id}/exports`;
  await page.route(url, route => route.fulfill({ status: 500, json: { error: { message: '导出文件不可写' } } }));
  await page.getByLabel('字幕正文').fill('工程已保存但导出失败');
  await page.getByRole('button', { name: '导出普通 SRT', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('导出文件不可写');
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const saved = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(saved.entries[1].text).toBe('工程已保存但导出失败');
  expect(saved.exports).toEqual([]);
  await page.unroute(url);
  const exported = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '重试导出', exact: true }).click();
  const result = await (await exported).json();
  expect(await fs.readFile(result.export.path, 'utf8')).toContain('工程已保存但导出失败');
});

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
