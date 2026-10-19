import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

async function openFixture(page: Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const response = await page.request.post('/api/projects', { data: {
    name: `布局-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: path.join(inputs, '来源.srt'),
  } });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto('/');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  return project;
}

test('普通浏览器窗口无需缩小页面，工作区和时间轴均完整可用', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 650 });
  await openFixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(650);
  const timeline = await page.getByRole('region', { name: '时间轴轨道滚动区' }).boundingBox();
  expect(timeline!.height).toBeGreaterThan(130);
  expect(timeline!.y + timeline!.height).toBeLessThanOrEqual(650);
  expect(await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
  await page.screenshot({ path: info.outputPath('layout-1280.jpg') });
  const width = (await page.getByRole('region', { name: '视频预览', exact: true }).boundingBox())!.width;
  await page.getByRole('button', { name: '视图', exact: true }).click();
  await page.getByRole('button', { name: '显示资源面板', exact: true }).click();
  expect((await page.getByRole('region', { name: '视频预览', exact: true }).boundingBox())!.width).toBeGreaterThan(width);
  expect((await page.getByRole('region', { name: '字幕编辑器', exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(280);
});

test('跳转播放时间后时间轴显示播放头，缩放细分而非两倍跳变', async ({ page }) => {
  await openFixture(page);
  const zoom = page.getByLabel('时间轴缩放', { exact: true });
  await zoom.fill('3');
  await page.getByLabel('跳转时间', { exact: true }).fill('7');
  await page.getByRole('button', { name: '跳转', exact: true }).click();
  const tracks = page.getByRole('region', { name: '时间轴轨道滚动区' });
  await expect.poll(async () => {
    const region = (await tracks.boundingBox())!;
    const head = (await page.getByRole('button', { name: '拖动播放头' }).boundingBox())!;
    return head.x >= region.x && head.x < region.x + region.width;
  }).toBe(true);
  expect(Number(await zoom.getAttribute('step'))).toBeLessThanOrEqual(.125);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(async () => {
    const bounds = (await tracks.boundingBox())!;
    const head = (await page.getByRole('button', {name:'拖动播放头'}).boundingBox())!;
    return head.x >= bounds.x + 150 && head.x <= bounds.x + bounds.width;
  }).toBe(true);
});

test('隐藏总览和调节轨高不改工程，边缘拖动持续滚动且 Esc 恢复', async ({ page }) => {
  const project = await openFixture(page);
  const region = page.getByRole('region', { name: '时间轴轨道滚动区' });
  await page.getByRole('checkbox', { name: '字幕总览', exact: true }).uncheck();
  await expect(page.getByRole('button', { name: '选择轨道 字幕总览', exact: true })).toHaveCount(0);
  const videoTrack = page.locator('.track').filter({ has: page.getByRole('button', { name: '选择轨道 🔒 视频轨', exact: true }) });
  const initial = (await videoTrack.boundingBox())!.height;
  const handle = page.getByRole('separator', { name: '调整轨道高度 🔒 视频轨', exact: true });
  await handle.focus(); await page.keyboard.press('ArrowDown');
  expect((await videoTrack.boundingBox())!.height).toBe(initial + 10);
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + 40, bounds.y + 3); await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + 55);
  expect((await videoTrack.boundingBox())!.height).toBeGreaterThan(initial + 50);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await videoTrack.boundingBox())!.height).toBe(initial + 10);
  await page.getByLabel('时间轴缩放', { exact: true }).fill('3');
  const scrollStart = await region.evaluate(el => el.scrollLeft);
  const rect = (await region.boundingBox())!;
  await page.mouse.move(rect.x + rect.width - 24, rect.y + 12); await page.mouse.down();
  await expect(page.getByRole('status', { name: '播放头拖动预览' })).toBeVisible();
  await expect.poll(() => region.evaluate(el => el.scrollLeft)).toBeGreaterThan(scrollStart + 100);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByRole('status', { name: '播放头拖动预览' })).toHaveCount(0);
  expect(await region.evaluate(el => el.scrollLeft)).toBe(scrollStart);
  expect(await (await page.request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
});

test('实际缩略图适配轨高且拖动时展示参考帧，波形默认隐藏可独立打开', async ({ page }) => {
  const project = await openFixture(page);
  await expect(page.getByRole('checkbox', { name: '音频波形', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '视频缩略图', exact: true })).toBeChecked();
  for (const kind of ['thumbnails', 'waveform']) {
    const started = await (await page.request.post(`/api/projects/${project.id}/timeline-media/${kind}`, { data: {} })).json();
    await expect.poll(async () => (await (await page.request.get(`/api/projects/${project.id}/tasks/${started.id}`)).json()).state).toBe('succeeded');
  }
  await page.getByRole('button', { name: '刷新缩略图状态', exact: true }).click();
  await page.getByRole('button', { name: '刷新波形状态', exact: true }).click();
  const image = page.getByRole('img', { name: '原片缩略图 00:00:00.000', exact: true });
  await expect(image).toBeVisible();
  const firstHeight = (await image.boundingBox())!.height;
  const resize = page.getByRole('separator', { name: '调整轨道高度 🔒 视频轨', exact: true });
  await resize.focus(); await page.keyboard.press('ArrowDown');
  expect((await image.boundingBox())!.height).toBe(firstHeight + 10);
  await expect(page.getByRole('img', { name: '音频波形', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '音频波形', exact: true }).check();
  await expect(page.getByRole('img', { name: '音频波形', exact: true })).toBeAttached();
  expect(await page.getByRole('img', { name: '音频波形', exact: true }).getAttribute('height')).toBe('96');
  const ruler = (await page.getByLabel('原片时间刻度', { exact: true }).boundingBox())!;
  await page.mouse.move(ruler.x + ruler.width / 2, ruler.y + 12); await page.mouse.down();
  const preview = page.getByRole('status', { name: '播放头拖动预览' });
  await expect(preview.getByRole('img')).toBeVisible();
  expect(await preview.getByRole('img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect((await preview.boundingBox())!.y).toBeLessThan(ruler.y);
  await page.mouse.up(); await expect(preview).toHaveCount(0);
  await page.getByRole('checkbox', { name: '视频缩略图', exact: true }).uncheck();
  await expect(image).toHaveCount(0);
});

test('打开按字幕条数降序，编辑期间不跳轨，手动排序后键盘按可见顺序换人', async ({ page }) => {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, `排序-${Date.now()}.jsonl`);
  await fs.writeFile(subtitle, ['少', '多', '多', '?', 'NONSPEECH'].map((speaker, i) => JSON.stringify({ idx: i + 1, start: i, end: i + .5, speaker, text: `台词${i}` })).join('\n'));
  const project = await (await page.request.post('/api/projects', { data: {
    name: `排序-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl',
  } })).json();
  await page.goto('/'); await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name: project.name, exact: true }).click();
  const labels = page.locator('.track-label');
  await expect(labels).toHaveText(['🔒 视频轨', '字幕总览', '多', '少', '未标注 ?', '非对白 NONSPEECH']);
  // Opening is a view preference, not a silent document edit.
  expect(await (await page.request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  await page.getByRole('button', { name: '列表字幕 2', exact: true }).click();
  await page.getByLabel('说话人归属', { exact: true }).selectOption('少');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await expect(labels).toHaveText(['🔒 视频轨', '字幕总览', '多', '少', '未标注 ?', '非对白 NONSPEECH']);
  await page.getByRole('button', { name: '按字幕数排序', exact: true }).click();
  await expect(labels).toHaveText(['🔒 视频轨', '字幕总览', '少', '多', '未标注 ?', '非对白 NONSPEECH']);
  await page.getByRole('button', { name: '列表字幕 2', exact: true }).click();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('说话人名称', { exact: true })).toHaveValue('多');
  // Creating/undoing a speaker must not reset the count-sorted view.
  await page.getByRole('button', {name:'按字幕数排序',exact:true}).click();
  await expect(labels).toHaveText(['🔒 视频轨', '字幕总览', '多', '少', '未标注 ?', '非对白 NONSPEECH']);
  await page.getByLabel('说话人名称', { exact: true }).fill('新人物');
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(labels).toHaveText(['🔒 视频轨', '字幕总览', '多', '少', '未标注 ?', '非对白 NONSPEECH']);
});

test('计数排序与保存轨序不同时手动重排可完整撤销和重做', async ({ page }) => {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, `排序历史-${Date.now()}.jsonl`);
  await fs.writeFile(subtitle, ['甲', '乙', '乙'].map((speaker, i) => JSON.stringify({idx:i + 1, start:i, end:i + .5, speaker, text:`排序历史${i}`})).join('\n'));
  const project = await (await page.request.post('/api/projects', { data: {name:`排序历史-${Date.now()}`, media_path:path.join(inputs,'短片.mp4'), subtitle_path:subtitle, format:'normalized-jsonl'} })).json();
  await page.goto('/'); await page.getByRole('button', {name:'文件',exact:true}).click();
  await page.getByRole('button', {name:'打开工程…'}).click(); await page.getByRole('button', {name:project.name,exact:true}).click();
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨','字幕总览','乙','甲','未标注 ?','非对白 NONSPEECH']);
  await page.getByRole('tab', {name:'说话人',exact:true}).click();
  const source = page.getByLabel('拖动排序 乙', {exact:true});
  const target = page.getByLabel('拖动排序 甲', {exact:true});
  await source.dragTo(target);
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨','字幕总览','甲','乙','未标注 ?','非对白 NONSPEECH']);
  await page.getByRole('button', {name:'撤销',exact:true}).click();
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨','字幕总览','乙','甲','未标注 ?','非对白 NONSPEECH']);
  await page.getByRole('button', {name:'重做',exact:true}).click();
  await expect(page.locator('.track-label')).toHaveText(['🔒 视频轨','字幕总览','甲','乙','未标注 ?','非对白 NONSPEECH']);
});

test('大量重叠层的轨道仍可增高，调整不改变字幕和工程', async ({ page }) => {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, `重叠轨高-${Date.now()}.jsonl`);
  await fs.writeFile(subtitle, Array.from({length:12}, (_,i) => JSON.stringify({idx:i+1,start:1,end:4,speaker:'甲',text:`同时间${i}`})).join('\n'));
  const project = await (await page.request.post('/api/projects', {data:{name:`轨高-${Date.now()}`,media_path:path.join(inputs,'短片.mp4'),subtitle_path:subtitle,format:'normalized-jsonl'}})).json();
  await page.goto('/'); await page.getByRole('button',{name:'文件',exact:true}).click();
  await page.getByRole('button',{name:'打开工程…'}).click(); await page.getByRole('button',{name:project.name,exact:true}).click();
  const handle = page.getByRole('separator',{name:'调整轨道高度 字幕总览',exact:true});
  const track = page.locator('.track').filter({has:handle});
  const height = (await track.boundingBox())!.height;
  expect(height).toBeGreaterThan(320);
  await handle.focus(); await page.keyboard.press('ArrowDown');
  expect((await track.boundingBox())!.height).toBe(height + 10);
  const scrolled = await page.getByRole('region', {name:'时间轴轨道滚动区'}).evaluate(el => {
    el.scrollTop = 0;
    el.dispatchEvent(new WheelEvent('wheel', {deltaMode:2,deltaX:1,deltaY:1,bubbles:true,cancelable:true}));
    return {actual:el.scrollTop, expected:Math.min(el.clientHeight, el.scrollHeight-el.clientHeight)};
  });
  expect(scrolled.actual).toBe(scrolled.expected);
  expect(await (await page.request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
});
