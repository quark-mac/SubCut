import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Project } from '../src/api';

const root = path.resolve('.test-workspace/long-film');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function open(page: Page, name: string) {
  await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, name).click();
  await button(page, '工程轨序').click();
}
async function longMedia() {
  await fs.mkdir(root, { recursive: true });
  const media = path.join(root, 'two-hours.mp4');
  try { await fs.access(media); } catch {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=1:d=7200',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=7200', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-crf', '35', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '12k', '-movflags', '+faststart', media], { timeout: 120000 });
  }
  return media;
}

test('长片30秒视窗居中播放头，手动滚走后重复点击仍可找回', async ({ page }) => {
  const media = await longMedia();
  const response = await page.request.post('/api/projects', {data:{name:`30秒-${Date.now()}`,media_path:media,subtitle_path:path.resolve('.test-workspace/inputs/来源.srt')}});
  const project = await response.json();
  await page.goto('/'); await open(page, project.name);
  await page.getByLabel('跳转时间', {exact:true}).fill('01:00:00'); await button(page,'跳转').click();
  const viewport = page.getByRole('region',{name:'时间轴轨道滚动区'});
  const centered = async () => {
    const box = (await viewport.boundingBox())!;
    const head = (await page.getByRole('button',{name:'拖动播放头'}).boundingBox())!;
    return Math.abs(head.x + head.width / 2 - (box.x + 150 + (box.width - 150) / 2));
  };
  await button(page,'30 秒视窗').click();
  await expect.poll(centered).toBeLessThan(10);
  await viewport.evaluate(el => {el.scrollLeft=0;});
  await button(page,'30 秒视窗').click();
  await expect.poll(centered).toBeLessThan(10);
  expect(await (await page.request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
});

test('两小时4000条26人物可见范围、滚动缩放及完整编辑保存导出', async ({ page, browser, context }) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const media = await longMedia();
  const subtitle = path.join(root, '4000.jsonl');
  await fs.writeFile(subtitle, Array.from({ length: 4000 }, (_, i) => JSON.stringify({
    idx: 9000 - i, start: i * 1.75, end: i * 1.75 + 1.6, speaker: i % 97 === 0 ? '?' : i % 89 === 0 ? 'NONSPEECH' : `人物${i % 24}`,
    text: `长片台词 ${i + 1}\n第二行 [正文]: 不猜标签`, tags: ['MULTI'], source_entries: [i + 8, i + 8, 2],
  })).join('\n'));
  const created = await page.request.post('/api/projects', { data: { name: `长片-${Date.now()}`, media_path: media, subtitle_path: subtitle, format: 'normalized-jsonl' } });
  expect(created.status()).toBe(201);
  const project: Project = await created.json();
  expect(project.media.duration_ms).toBe(7200000);
  const cdp = await context.newCDPSession(page); await cdp.send('Network.clearBrowserCache');
  await page.goto('/');
  const start = Date.now(); await open(page, project.name);
  await expect(button(page, '列表字幕 1')).toBeVisible();
  const coldLoadMs = Date.now() - start;
  // Public DOM: rendering is bounded, while the complete document stays intact.
  expect(await page.locator('.subtitle-row').count()).toBeLessThan(80);
  // Taller viewport exposes more lanes, but never both complete 4000-entry views.
  expect(await page.locator('.clip').count()).toBeLessThan(3000);
  const fitRendered = { rows: await page.locator('.subtitle-row').count(), clips: await page.locator('.clip').count() };
  const fitSamples = await page.evaluateHandle(() => {
    const frames: number[] = [], tasks: number[] = []; let running = true, previous = performance.now();
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
    observer.observe({ type: 'longtask' });
    const next = (now: number) => { frames.push(now - previous); previous = now; if (running) requestAnimationFrame(next); };
    requestAnimationFrame(next);
    return { finish: () => { running = false; observer.disconnect(); return { frames, tasks }; } };
  });
  await button(page, '播放').click(); await page.waitForTimeout(2200); await button(page, '暂停').click();
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1);
  const fitPlayback = await fitSamples.evaluate(m => m.finish()); await fitSamples.dispose();
  const list = page.getByLabel('字幕列表', { exact: true });
  await list.evaluate(e => { e.scrollTop = e.scrollHeight; });
  await expect(button(page, '列表字幕 4000')).toBeVisible();
  await button(page, '列表字幕 4000').click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('长片台词 4000\n第二行 [正文]: 不猜标签');
  const searchStart = Date.now(); await page.getByLabel('搜索字幕').fill('长片台词 2400\n');
  await expect(button(page, '列表字幕 2400')).toBeVisible();
  const searchMs = Date.now() - searchStart;
  await button(page, '列表字幕 2400').click();
  await button(page, '清除筛选').click();
  await expect(button(page, '列表字幕 2400')).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.request.get(`/api/projects/${project.id}`);
  expect((await saved.json()).entries).toEqual(project.entries);
  const tracks = page.getByRole('region', { name: '时间轴轨道滚动区' });
  await page.getByLabel('时间轴缩放', { exact: true }).fill('8');
  await tracks.evaluate(e => {
    const width = e.querySelector<HTMLElement>('.track-body')!.clientWidth;
    e.scrollLeft = 4198.25 / 7200 * width - 200; e.scrollTop = 90;
  });
  const target = project.entries[2399];
  const overview = page.locator(`.track:nth-child(3) [data-entry-id="${target.id}"]`);
  await expect(overview).toBeVisible(); await overview.click();
  // Selection survives removal/remount of both timeline and list nodes.
  await tracks.evaluate(e => { e.scrollLeft = 0; e.scrollTop = e.scrollHeight; });
  await expect(page.locator(`.clip[data-entry-id="${target.id}"]`)).toHaveCount(0);
  await tracks.evaluate(e => { e.scrollLeft = 4198.25 / 7200 * e.querySelector<HTMLElement>('.track-body')!.clientWidth - 200; e.scrollTop = 90; });
  await expect(overview).toHaveAttribute('aria-pressed', 'true');
  const measurements = await page.evaluateHandle(() => {
    const frames: number[] = [], tasks: number[] = []; let previous = performance.now(), running = true;
    const observer = new PerformanceObserver(list => { tasks.push(...list.getEntries().map(e => e.duration)); });
    observer.observe({ type: 'longtask', buffered: false });
    const frame = (now: number) => { frames.push(now - previous); previous = now; if (running) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    return { finish: () => { running = false; observer.disconnect(); return { frames, tasks }; } };
  });
  const editStart = Date.now();
  await button(page, '播放').click();
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.getByLabel('字幕正文').fill('播放中长片修改\n来源保持');
  const inputMs = Date.now() - editStart;
  const saveStart = Date.now(); await button(page, '保存工程').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const saveMs = Date.now() - saveStart;
  await page.waitForTimeout(2200);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(4199);
  await expect(button(page, '列表字幕 2400')).toHaveAttribute('aria-pressed', 'true');
  await button(page, '暂停').click();
  const playback = await measurements.evaluate(m => m.finish());
  await measurements.dispose();
  await button(page, '撤销').click();
  await expect(page.getByLabel('字幕正文')).toHaveValue(target.text);
  await button(page, '重做').click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('播放中长片修改\n来源保持');
  await page.getByLabel('跳转时间', { exact: true }).fill('01:09:59.000'); await button(page, '跳转').click();
  await button(page, '拆分字幕').click();
  await expect(page.getByLabel('选择数量', { exact: true })).toHaveText('已选 2 条');
  await button(page, '撤销').click();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  const speaker = project.speakers.find(s => s.id === target.speaker_id)!;
  await page.getByRole('group', { name: `说话人 ${speaker.label}`, exact: true }).getByRole('button', { name: '编辑人物' }).click();
  await page.getByLabel('人物名称', { exact: true }).fill('长片改名');
  await button(page, '应用人物设置').click();
  await button(page, '保存工程').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const edited: Project = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(edited.entries).toHaveLength(4000);
  expect(edited.entries[2399]).toEqual({ ...target, text: '播放中长片修改\n来源保持' });
  expect(edited.entries.filter(e => e.id !== target.id)).toEqual(project.entries.filter(e => e.id !== target.id));
  const reopenStart = Date.now(); await page.reload(); await open(page, project.name);
  await expect(button(page, '列表字幕 1')).toBeVisible();
  const hotReopenMs = Date.now() - reopenStart;
  await expect(button(page, '撤销')).toBeDisabled();
  const outputs: Record<string, { path: string; entries: number }> = {};
  for (const [format, label] of Object.entries({ 'speaker-srt': '说话人 SRT', 'plain-srt': '普通 SRT', 'normalized-jsonl': '项目 JSONL', 'moss-json': 'MOSS JSON' })) {
    await page.getByLabel('导出格式').selectOption(format);
    const response = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
    await button(page, `导出${label}`).click();
    const result = await (await response).json();
    const text = await fs.readFile(result.export.path, 'utf8');
    expect(await (await page.request.get(result.url)).text()).toBe(text);
    const count = format === 'moss-json' ? JSON.parse(text).length : format === 'normalized-jsonl' ? text.trim().split('\n').length : (text.match(/ --> /g) ?? []).length;
    expect(count).toBe(4000); expect(text).toContain('播放中长片修改');
    if (format === 'normalized-jsonl') expect(JSON.parse(text.trim().split('\n')[2399])).toEqual({ idx: 2400, start: 4198.25, end: 4199.85, text: '播放中长片修改\n来源保持', speaker: '长片改名', tags: ['MULTI'], source_entries: [2407, 2407, 2] });
    outputs[format] = { path: result.export.path, entries: count };
  }
  await page.getByLabel('搜索字幕').fill('播放中长片修改');
  await button(page, '列表字幕 2400').click();
  await page.screenshot({ path: '../tests/evidence/ticket-13-long-film.jpg' });
  expect(errors).toEqual([]);
  await fs.writeFile('../tests/evidence/ticket-13-scale.json', JSON.stringify({ browser: browser.version(), coldLoadMs, hotReopenMs, searchMs, inputMs, saveMs, fitRendered, fitPlayback, playback, outputs,
    durationMs: project.media.duration_ms, entries: project.entries.length, speakers: project.speakers.length,
    renderedRows: await page.locator('.subtitle-row').count(), renderedClips: await page.locator('.clip').count(),
    cache: 'Browser HTTP cache explicitly cleared before open; OS file cache not flushed; fixture generation/import read media.' }, null, 2));
});

test('开放长人物名不会改变虚拟轨道坐标，纵向滚动后字幕仍可点击框选', async ({ page }) => {
  test.setTimeout(45000); page.setDefaultTimeout(10000);
  const media = await longMedia();
  const subtitle = path.join(root, 'long-labels.jsonl');
  const labels = Array.from({ length: 5 }, (_, i) => `开放人物${i}·${'很长的组合人物名称'.repeat(8)}`);
  await fs.writeFile(subtitle, Array.from({ length: 200 }, (_, i) => JSON.stringify({ idx: i + 1, start: i * 30 + 1, end: i * 30 + 21,
    speaker: labels[i % 5], text: `长名条目${i + 1}`,
  })).join('\n'));
  const response = await page.request.post('/api/projects', { data: { name: `长名轨道-${Date.now()}`, media_path: media, subtitle_path: subtitle, format: 'normalized-jsonl' } });
  expect(response.status()).toBe(201); const project: Project = await response.json();
  await page.goto('/'); await open(page, project.name);
  await button(page, `选择轨道 ${labels[4]}`).scrollIntoViewIfNeeded();
  const clip = button(page, `${labels[4]}：长名条目5`);
  await expect(clip).toBeVisible(); await clip.click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('长名条目5');
  const b = (await clip.boundingBox())!;
  await page.mouse.move(b.x - 1, b.y - 1); await page.mouse.down();
  await page.mouse.move(b.x + b.width + 1, b.y + b.height + 1, { steps: 5 }); await page.mouse.up();
  await expect(clip).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, '撤销')).toBeDisabled();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries).toEqual(project.entries);
});

test('长片重叠错层可命中，虚拟卸载后的跨视窗框选和双视图去重完整撤销', async ({ page }) => {
  test.setTimeout(60000); page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const media = await longMedia();
  const subtitle = path.join(root, 'overlaps.jsonl');
  await fs.writeFile(subtitle, Array.from({ length: 4000 }, (_, i) => JSON.stringify({
    idx: i + 1, start: (i % 100 === 1 ? i - 1 : i) * 1.75, end: (i % 100 === 1 ? i - 1 : i) * 1.75 + 1.6,
    speaker: i % 100 <= 1 ? '重叠人' : `人物${i % 24}`, text: `框选长片 ${i + 1}`, tags: ['MERGED'], source_entries: [i, i],
  })).join('\n'));
  const response = await page.request.post('/api/projects', { data: { name: `长片重叠-${Date.now()}`, media_path: media, subtitle_path: subtitle, format: 'normalized-jsonl' } });
  expect(response.status()).toBe(201); const project: Project = await response.json();
  await page.goto('/'); await open(page, project.name);
  const splitter = (await page.getByRole('separator', { name: '调整上下分区高度' }).boundingBox())!;
  await page.mouse.move(splitter.x + 200, splitter.y + 3); await page.mouse.down(); await page.mouse.move(splitter.x + 200, splitter.y - 180); await page.mouse.up();
  const tracks = page.getByRole('region', { name: '时间轴轨道滚动区' });
  await page.getByLabel('时间轴缩放', { exact: true }).fill('8');
  await tracks.evaluate(e => {
    e.scrollLeft = 3500 / 7200 * e.querySelector<HTMLElement>('.track-body')!.clientWidth - 200;
    // Leave blank overview space below the sticky ruler; video height is now adjustable.
    e.scrollTop = e.querySelector<HTMLElement>('.track')!.offsetHeight - 20;
  });
  const first = button(page, '字幕总览：框选长片 2001'), second = button(page, '字幕总览：框选长片 2002');
  await first.click(); await expect(page.getByLabel('字幕正文')).toHaveValue('框选长片 2001');
  await second.click(); await expect(page.getByLabel('字幕正文')).toHaveValue('框选长片 2002');
  const a = (await first.boundingBox())!, b = (await second.boundingBox())!;
  expect(b.y).toBeGreaterThan(a.y);
  await button(page, '吸附').click();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const moved: Project = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(moved.entries[2001].start_ms).toBeGreaterThan(3500000);
  expect(moved.entries[2001].end_ms - moved.entries[2001].start_ms).toBe(1600);
  expect(moved.entries.filter(e => e.id !== project.entries[2001].id)).toEqual(project.entries.filter(e => e.id !== project.entries[2001].id));
  await button(page, '撤销').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries).toEqual(project.entries);
  const speakerSecond = (await button(page, '重叠人：框选长片 2002').boundingBox())!;
  await page.mouse.move(a.x - 1, a.y - 1); await page.mouse.down();
  await page.mouse.move(a.x + a.width + 2, speakerSecond.y + speakerSecond.height + 1, { steps: 5 }); await page.mouse.up();
  await expect(page.getByLabel('选择数量')).toHaveText('已选 2 条');
  await expect(button(page, '撤销')).toBeDisabled();
  // Extend a new marquee by scrolling while the pointer is captured. Early
  // blocks unmount, but all ten geometrically crossed entries remain selected.
  await page.mouse.move(a.x - 1, a.y - 1); await page.mouse.down();
  const area = (await tracks.boundingBox())!;
  await page.mouse.move(area.x + 400, b.y + b.height + 1, { steps: 5 });
  await tracks.evaluate(e => { e.scrollLeft = 3516 / 7200 * e.querySelector<HTMLElement>('.track-body')!.clientWidth - (400 - 150); });
  await expect(page.getByLabel('选择数量')).toHaveText('已选 10 条');
  await page.mouse.up();
  await button(page, '删除选中字幕').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const deleted: Project = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const removed = new Set(project.entries.slice(2000, 2010).map(e => e.id));
  expect(deleted.entries).toEqual(project.entries.filter(e => !removed.has(e.id)));
  await button(page, '撤销').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries).toEqual(project.entries);
  expect(errors).toEqual([]);
  await fs.writeFile('../tests/evidence/ticket-13-virtual-selection.json', JSON.stringify({ projectId: project.id, entries: 4000, overlapIds: project.entries.slice(2000, 2002).map(e => e.id), removedIds: [...removed], restoredCompleteEntries: true }, null, 2));
});
