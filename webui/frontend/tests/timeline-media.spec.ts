import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/api';

const root = path.resolve('.test-workspace/timeline-media');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function open(page: Page, name: string) {
  await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, name).click();
  await page.getByRole('checkbox', { name: '音频波形', exact: true }).check();
  // Keep one-second samples visible for the alignment probes; height is now user adjustable.
  const handle = (await page.getByRole('separator', { name: '调整轨道高度 🔒 视频轨', exact: true }).boundingBox())!;
  await page.mouse.move(handle.x + 40, handle.y + 3); await page.mouse.down();
  await page.mouse.move(handle.x + 40, handle.y - 23); await page.mouse.up();
  await button(page, '工程资源菜单').click();
}
async function fixture(page: Page, { incompatible = false, silent = false, delayed = false, large = false, pulses = false, progress = false }: {
  incompatible?: boolean; silent?: boolean; delayed?: boolean; large?: boolean; pulses?: boolean; progress?: boolean;
} = {}) {
  const folder = path.join(root, String(Date.now()));
  execFileSync(process.env.WEBUI_PYTHON || 'python', ['-c',
    'from pathlib import Path; from webui.tests.fixtures import create_preview_fixture; import sys; create_preview_fixture(Path(sys.argv[1]), offset=5, silent=sys.argv[2]=="True")', folder, String(silent ? 'True' : 'False')], { cwd: '../..' });
  let media = path.join(folder, `markers-offset-5-silent-${silent ? 'True' : 'False'}.mkv`);
  if (pulses) {
    const output = path.join(folder, 'pulses.mkv');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', media, '-f', 'lavfi', '-i',
      "aevalsrc='0.4*sin(2*PI*880*t)*(between(t,0.95,1.05)+between(t,4.95,5.05)+between(t,8.45,8.55))':s=48000:d=9",
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', output]);
    // The fixture remux retains every video frame and gives video and lavfi one zero origin.
    media = output;
  }
  if (delayed) {
    const output = path.join(folder, 'delayed.mkv');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', media, '-itsoffset', '0.5', '-i', media, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-output_ts_offset', '5', output]);
    media = output;
  }
  if (large) {
    const output = path.join(folder, 'large.mkv');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-stream_loop', '5', '-i', media, '-vf', 'scale=1280:720', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-t', '54', output]);
    media = output;
  }
  if (progress) {
    // Flat FFV1 marker frames decode in ~0.17s despite a 54s source duration.
    // Use genuine moving, compressed 1080p content for observable sustained work.
    media = path.join(root, 'progress-240s-1080p-v1.mp4');
    try { await fs.access(media); } catch {
      const staging = path.join(root, 'progress-240s-1080p-v1.partial.mp4');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25',
        '-t', '240', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-an', staging]);
      await fs.rename(staging, media);
    }
  }
  if (!incompatible) {
    const mp4 = path.join(folder, 'direct.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-copyts', '-start_at_zero', '-i', media, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4]);
    media = mp4;
  }
  const response = await page.request.post('/api/projects', { data: { name: `波形缩略图-${Date.now()}`, media_path: media, subtitle_path: path.join(folder, 'markers.srt') } });
  expect(response.status()).toBe(201);
  const project = await response.json() as Project;
  await page.goto('/'); await open(page, project.name);
  return project;
}

test('真实原片生成、缓存与视频轨可见范围在多个缩放滚动位置按原片时间对齐', async ({ page, browser }) => {
  const project = await fixture(page, { pulses: true });
  await button(page, '生成音频波形').click();
  await expect(page.getByRole('status', { name: '波形任务状态' })).toContainText('成功');
  await button(page, '生成画面缩略图').click();
  await expect(page.getByRole('status', { name: '缩略图任务状态' })).toContainText('成功');
  const locked = page.locator('.timeline-content');
  await expect(locked.getByRole('img', { name: '音频波形', exact: true })).toBeVisible();
  await expect(locked.locator('img').first()).toBeVisible();
  await expect.poll(() => locked.locator('rect[data-time-ms="5000"]').getAttribute('data-peak')).toMatch(/^0\.[34]/);
  for (const [ms, audible] of [[1000, true], [3000, false], [5000, true], [7000, false], [8500, true]] as const) {
    expect(Number(await locked.locator(`rect[data-time-ms="${ms}"]`).getAttribute('data-peak')) > .3).toBe(audible);
  }
  for (const viewport of [{ width: 1100, height: 800 }, { width: 1800, height: 1000 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => locked.evaluate(el => {
      const ruler = document.querySelector('.ruler')!.getBoundingClientRect();
      const frame = el.querySelector('img[data-time-ms="4000"]')?.getBoundingClientRect();
      return frame ? Math.abs(frame.left - (ruler.left + 4000 / 9000 * ruler.width)) : Infinity;
    })).toBeLessThan(1.1);
  }
  const observations = [];
  for (const zoom of [0, 1, 3]) {
    await page.getByLabel('时间轴缩放', { exact: true }).fill(String(zoom));
    await page.getByRole('region', { name: '时间轴轨道滚动区' }).evaluate(el => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * .6; });
    await expect.poll(() => locked.locator('svg rect').count()).toBeGreaterThan(0);
    await expect.poll(async () => locked.evaluate(el => {
      const track = el.querySelector('.track-body.locked')!.getBoundingClientRect(), viewport = document.querySelector('.tracks')!;
      const last = el.querySelector('svg rect:last-child') as SVGElement;
      return Number(last.dataset.timeMs) <= (viewport.scrollLeft + viewport.clientWidth - 150) / track.width * 9000;
    })).toBe(true);
    const observed = await locked.evaluate(el => {
      const track = el.querySelector('.track-body.locked')!.getBoundingClientRect();
      const ruler = document.querySelector('.ruler')!.getBoundingClientRect();
      return { width: track.width, left: track.left, rulerLeft: ruler.left,
        images: [...el.querySelectorAll('img')].map(img => ({ ms: Number(img.dataset.timeMs), left: img.getBoundingClientRect().left, loaded: img.complete && img.naturalWidth > 0 })),
        bars: [...el.querySelectorAll('svg rect')].map(bar => ({ ms: Number((bar as SVGElement).dataset.timeMs), peak: Number((bar as SVGElement).dataset.peak), left: bar.getBoundingClientRect().left })),
        svgWidth: el.querySelector('svg')!.getBoundingClientRect().width, viewport: document.querySelector('.tracks')!.clientWidth };
    });
    for (const item of [...observed.images, ...observed.bars]) expect(Math.abs(item.left - (observed.rulerLeft + item.ms / 9000 * observed.width))).toBeLessThan(1.1);
    expect(observed.svgWidth).toBeLessThanOrEqual(observed.viewport + 2);
    expect(observed.bars.length).toBeLessThanOrEqual(1441);
    expect(observed.images.length).toBeLessThanOrEqual(18);
    observations.push({ zoom, ...observed });
  }
  await button(page, '适合全片').click();
  await page.getByLabel('跳转时间', { exact: true }).fill('00:00:05,000'); await button(page, '跳转').click();
  await expect(page.locator('.subtitle-overlay')).toContainText('绿色');
  await expect.poll(() => locked.locator('img[data-time-ms="5000"]').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const pixel = await locked.locator('img[data-time-ms="5000"]').evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  expect(pixel[1]).toBeGreaterThan(240); expect(pixel[0]).toBeLessThan(10); expect(pixel[2]).toBeLessThan(10);
  const disk = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(disk.entries).toEqual(project.entries); expect(disk.revision).toBe(1);
  await expect(button(page, '撤销')).toBeDisabled();
  await page.screenshot({ path: '../tests/evidence/ticket-12-timeline.jpg' });
  await page.reload(); await open(page, project.name);
  await expect(page.locator('.locked svg')).toBeVisible();
  await expect(page.locator('.locked img').first()).toBeVisible();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).media_artifacts).toHaveLength(2);
  await fs.writeFile('../tests/evidence/ticket-12-alignment.json', JSON.stringify({ browser: browser.version(), project: project.id, observations }, null, 2));
});

test('非零 PTS 与延迟音轨使用原片零点，预览切换不移动波形缩略图；无音轨为空', async ({ page }) => {
  const project = await fixture(page, { incompatible: true, delayed: true });
  await button(page, '生成音频波形').click();
  await expect(page.getByRole('status', { name: '波形任务状态' })).toContainText('成功');
  await button(page, '生成画面缩略图').click();
  await expect(page.getByRole('status', { name: '缩略图任务状态' })).toContainText('成功');
  // Verify independent audible/silent references directly from rendered evidence in Edge.
  for (const [ms, audible] of [[200, false], [700, true], [2700, false], [4700, true]] as const) {
    const bar = page.locator(`.locked rect[data-time-ms="${ms}"]`);
    await expect(bar).toHaveCount(1);
    expect(Number(await bar.getAttribute('data-peak')) > .3).toBe(audible);
  }
  const before = await page.locator('.locked').first().evaluate(el => [...el.querySelectorAll('img')].map(img => ({ time: img.dataset.timeMs, src: img.src, left: img.getBoundingClientRect().left })));
  await button(page, '生成预览副本').click();
  await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
  await page.getByLabel('跳转时间', { exact: true }).fill('00:00:05,000'); await button(page, '跳转').click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.seeking && Math.abs(v.currentTime - 5) < .01)).toBe(true);
  const pixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    return [document.querySelector('video')!, document.querySelector('.locked img[data-time-ms="5000"]')!].map(image => {
      ctx.drawImage(image as CanvasImageSource, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];
    });
  });
  for (const pixel of pixels) { expect(pixel[1]).toBeGreaterThan(240); expect(pixel[0]).toBeLessThan(10); }
  expect(await page.locator('.locked').first().evaluate(el => [...el.querySelectorAll('img')].map(img => ({ time: img.dataset.timeMs, src: img.src, left: img.getBoundingClientRect().left })))).toEqual(before);
  await expect(button(page, '撤销')).toBeDisabled();
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries).toEqual(project.entries);
  await page.screenshot({ path: '../tests/evidence/ticket-12-delayed-preview.jpg' });
  await fixture(page, { silent: true });
  await button(page, '生成音频波形').click();
  await expect(page.getByText('无音轨 · 空波形', { exact: true })).toBeVisible();
  await expect(page.locator('.locked svg')).toHaveCount(0);
  await button(page, '生成画面缩略图').click();
  await expect(page.locator('.locked img').first()).toBeVisible();
  await expect(button(page, '撤销')).toBeDisabled();
});

test('按下生成波形到松开之间返回真实媒体信息，不丢失点击或新密度生成意图', async ({ page }, testInfo) => {
  let releaseProbe!: () => void, probeRead!: () => void, releaseDensity!: () => void, densityRead!: () => void;
  const probeGate = new Promise<void>(resolve => { releaseProbe = resolve; });
  const probeCaptured = new Promise<void>(resolve => { probeRead = resolve; });
  const densityGate = new Promise<void>(resolve => { releaseDensity = resolve; });
  const densityCaptured = new Promise<void>(resolve => { densityRead = resolve; });
  await page.route('**/api/projects/*/playback?quality=standard', async route => {
    const response = await route.fetch(); probeRead(); await probeGate; await route.fulfill({ response });
  });
  const project = await fixture(page);
  await probeCaptured;
  await page.route(`**/api/projects/${project.id}/timeline-media/waveform?density=detailed`, async route => {
    const response = await route.fetch(); densityRead(); await densityGate; await route.fulfill({ response });
  });
  const requests: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes(project.id)) requests.push(request.url()); });
  const events = await page.evaluateHandle(() => {
    const records: { type: string; target: string }[] = [];
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => {
      const target = event.target as HTMLElement;
      if (target.closest('.resources')) records.push({ type, target: `${target.tagName}:${target.textContent?.trim().slice(0, 80)}` });
    }, true);
    return records;
  });
  let before: unknown, after: unknown, pressed = false;
  try {
    await page.getByLabel('波形采样密度', { exact: true }).selectOption('detailed'); await densityCaptured;
    const generate = button(page, '生成音频波形');
    await generate.scrollIntoViewIfNeeded();
    const rect = (await generate.boundingBox())!; before = rect;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); pressed = true;
    const delivered = page.waitForResponse(r => r.url().endsWith('/playback?quality=standard'));
    releaseProbe(); await delivered;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    after = await generate.boundingBox();
    await page.mouse.up(); pressed = false;
    await expect.poll(() => requests.filter(url => url.endsWith('/timeline-media/waveform')).length).toBe(1);
    expect(after).toEqual(before);
    releaseDensity();
    await expect(page.getByRole('status', { name: '波形任务状态' })).toContainText('成功');
    await expect(page.locator('.locked svg')).toBeVisible();
    const disk = await (await page.request.get(`/api/projects/${project.id}`)).json();
    expect(disk.entries).toEqual(project.entries); expect(disk.revision).toBe(1);
    expect(disk.media_artifacts.map((a: { parameters: { step_ms: number } }) => a.parameters.step_ms)).toEqual([5]);
  } finally {
    releaseProbe(); releaseDensity(); if (pressed) await page.mouse.up();
    const observation = JSON.stringify({ project: project.id, before, after, requests, events: await events.jsonValue() }, null, 2);
    await fs.mkdir('../tests/evidence/ticket-13-integration-fix', { recursive: true });
    await fs.writeFile('../tests/evidence/ticket-13-integration-fix/pointer-media-green.json', observation);
    await testInfo.attach('pointer-media.json', { body: observation, contentType: 'application/json' });
  }
});

test('晚到旧 GET 不能覆盖新密度任务，晚到完成与自动保存回执不能覆盖其他工程草稿', async ({ page }) => {
  const project = await fixture(page);
  const other = await (await page.request.post(`/api/projects/${project.id}/save-as`, { data: { revision: 1, name: `${project.name}-另存` } })).json() as Project;
  let releaseRead!: () => void, captured!: () => void;
  const gate = new Promise<void>(resolve => { releaseRead = resolve; });
  const readCaptured = new Promise<void>(resolve => { captured = resolve; });
  let first = true;
  await page.route(`**/api/projects/${project.id}/timeline-media/waveform?density=detailed`, async route => {
    if (!first) { await route.continue(); return; }
    first = false; const response = await route.fetch(); captured(); await gate; await route.fulfill({ response });
  });
  try {
    await page.getByLabel('波形采样密度', { exact: true }).selectOption('detailed'); await readCaptured;
    const submitted = page.waitForResponse(r => r.url().endsWith('/timeline-media/waveform') && r.request().method() === 'POST');
    await button(page, '生成音频波形').click();
    const task = await (await submitted).json(); expect(task.parameters.step_ms).toBe(5);
    releaseRead();
    await expect(page.getByRole('status', { name: '波形任务状态' })).toContainText('成功');
    await expect(page.locator('.locked svg')).toBeVisible();
  } finally { releaseRead(); }
  let releaseTask!: () => void, finished!: () => void;
  const taskGate = new Promise<void>(resolve => { releaseTask = resolve; });
  const taskDone = new Promise<void>(resolve => { finished = resolve; });
  await page.route(`**/api/projects/${project.id}/tasks/*`, async route => {
    const response = await route.fetch(); const task = await response.json();
    if (task.state === 'succeeded') { finished(); await taskGate; }
    await route.fulfill({ response });
  });
  let releaseSave!: () => void, saved!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  const savedOnDisk = new Promise<void>(resolve => { saved = resolve; });
  let held = false;
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'PUT' || held) { await route.continue(); return; }
    held = true; const response = await route.fetch(); saved(); await saveGate; await route.fulfill({ response });
  });
  try {
    await button(page, '生成画面缩略图').click();
    await button(page, '列表字幕 1').click();
    const editor = page.getByRole('textbox', { name: '字幕正文', exact: true });
    await editor.fill('第一代自动保存'); await button(page, '应用修改').click(); await savedOnDisk;
    await editor.fill('旧工程更新的草稿'); await taskDone; releaseSave();
    await expect(editor).toHaveValue('旧工程更新的草稿');
    await open(page, other.name);
    await button(page, '列表字幕 1').click(); await editor.fill('新工程独立草稿'); releaseTask();
    await page.waitForTimeout(400); await expect(editor).toHaveValue('新工程独立草稿');
    await expect(page.locator('.locked img')).toHaveCount(0);
    await button(page, '保存工程').click();
    await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
    const firstDisk = await (await page.request.get(`/api/projects/${project.id}`)).json();
    const secondDisk = await (await page.request.get(`/api/projects/${other.id}`)).json();
    expect(firstDisk.entries[0].text).toBe('旧工程更新的草稿'); expect(firstDisk.media_artifacts).toHaveLength(2);
    expect(secondDisk.entries[0].text).toBe('新工程独立草稿'); expect(secondDisk.media_artifacts).toEqual([]);
    await open(page, project.name); await expect(page.locator('.locked img').first()).toBeVisible();
  } finally { releaseRead(); releaseSave(); releaseTask(); }
});

test('真实缺工具和错误工具失败仍可编辑，修复工具后 UI 重试成功', async ({ browser }) => {
  test.setTimeout(60000);
  const folder = path.join(root, `tools-${Date.now()}`); await fs.mkdir(folder, { recursive: true });
  const executable = path.join(folder, 'configured-ffmpeg.exe');
  const listener = net.createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const service = spawn(process.env.WEBUI_PYTHON || 'python', ['-m', 'uvicorn', 'webui.backend.app:app', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: '../..', env: { ...process.env, WEBUI_WORKSPACE: path.join(folder, 'projects'), WEBUI_FFMPEG: executable }, stdio: 'pipe' });
  let logs = ''; service.stdout.on('data', data => { logs += data; }); service.stderr.on('data', data => { logs += data; });
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await expect.poll(async () => { try { return (await page.request.get('/api/health')).status(); } catch { return 0; } }).toBe(200);
    const project = await fixture(page);
    await button(page, '生成音频波形').click();
    await expect(page.getByRole('status', { name: '波形任务状态' })).toContainText('失败');
    await expect(page.getByRole('alert')).toContainText('未找到 ffmpeg');
    await button(page, '列表字幕 1').click(); await page.getByRole('textbox', { name: '字幕正文', exact: true }).fill('失败期间仍可保存');
    await button(page, '保存工程').click(); await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
    const locate = (name: string) => execFileSync('where.exe', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    await fs.copyFile(locate('ffprobe'), executable);
    await button(page, '重试生成音频波形').click(); await expect(page.getByRole('alert')).toContainText('FFmpeg 生成失败');
    await expect(page.locator('.locked svg')).toHaveCount(0);
    await fs.rm(executable, { force: true }); await fs.copyFile(locate('ffmpeg'), executable);
    await button(page, '重试生成音频波形').click(); await expect(page.locator('.locked svg')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries[0].text).toBe('失败期间仍可保存');
    await page.screenshot({ path: '../tests/evidence/ticket-12-retry.jpg' });
  } finally {
    await context.close(); service.kill(); await new Promise<void>(resolve => service.once('exit', () => resolve()));
    await fs.writeFile(path.join(folder, 'server.log'), logs); await fs.rm(executable, { force: true });
  }
});

test('同工程生成等待真实保存回执时刷新状态，不丢弃已经点击的生成意图', async ({ page }) => {
  const project = await fixture(page);
  await button(page, '列表字幕 1').click();
  await page.getByRole('textbox', { name: '字幕正文', exact: true }).fill('生成必须先保存此草稿');
  let release!: () => void, saved!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const onDisk = new Promise<void>(resolve => { saved = resolve; });
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return; }
    const response = await route.fetch(); saved(); await gate; await route.fulfill({ response });
  });
  try {
    await button(page, '生成画面缩略图').click(); await onDisk;
    const read = page.waitForResponse(r => r.url().includes(`/projects/${project.id}/timeline-media/thumbnails?`));
    await button(page, '刷新缩略图状态').click(); await read;
    release();
    await expect(page.getByRole('status', { name: '缩略图任务状态' })).toContainText('成功');
    await expect(page.locator('.locked img').first()).toBeVisible();
    const disk = await (await page.request.get(`/api/projects/${project.id}`)).json();
    expect(disk.entries[0].text).toBe('生成必须先保存此草稿');
    expect(disk.media_artifacts).toHaveLength(1);
  } finally { release(); }
});

test('54秒原片快速完成可以只回执成功，不要求已经错过的中间状态', async ({ page }) => {
  const project = await fixture(page, { incompatible: true, large: true });
  const observations: { state: string; progress: number }[] = [];
  await page.route(`**/api/projects/${project.id}/tasks/*`, async route => {
    // Delay only this browser response until the REAL job is done. No synthetic task,
    // FFmpeg throttle, private-module mock, or production minimum-duration rule.
    await expect.poll(async () => (await (await page.request.get(route.request().url())).json()).state).toBe('succeeded');
    const response = await route.fetch(); const task = await response.json();
    observations.push({ state: task.state, progress: task.progress });
    await route.fulfill({ response });
  });
  await button(page, '生成画面缩略图').click();
  await expect(page.getByRole('status', { name: '缩略图任务状态' })).toContainText('成功');
  await expect(page.locator('.locked img').first()).toBeVisible();
  expect(observations).toEqual([{ state: 'succeeded', progress: 1 }]);
  const disk = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(disk.entries).toEqual(project.entries); expect(disk.revision).toBe(1);
  await expect(button(page, '撤销')).toBeDisabled();
  await fs.writeFile('../tests/evidence/ticket-12-fast-progress.json', JSON.stringify({ project: project.id, duration_ms: disk.media.duration_ms, observations }, null, 2));
});

test('真实较长媒体显示中间进度、活动任务去重，未完成产物不供给时间轴', async ({ page }) => {
  test.setTimeout(60000);
  const project = await fixture(page, { incompatible: true, progress: true });
  const began = Date.now();
  const observations: { state: string; progress: number; processed_frames: number; progress_source: string; requested_ms: number; received_ms: number }[] = [];
  const intermediate = () => observations.filter(o => o.state === 'running' && o.progress > 0 && o.progress < .99);
  let release!: () => void, inspected = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${project.id}/tasks/*`, async route => {
    // Keep two genuine progress responses visible long enough to assert their DOM
    // rendering. The worker is never paused; later reads still see its real state.
    if (intermediate().length >= 2 && !inspected) await gate;
    const requested_ms = Date.now() - began;
    const response = await route.fetch(); const task = await response.json();
    observations.push({ state: task.state, progress: task.progress, processed_frames: task.processed_frames,
      progress_source: task.progress_source, requested_ms, received_ms: Date.now() - began });
    await route.fulfill({ response });
  });
  const submitted = page.waitForResponse(r => r.url().endsWith('/timeline-media/thumbnails') && r.request().method() === 'POST');
  await button(page, '生成画面缩略图').click();
  const task = await (await submitted).json();
  try {
    const duplicate = await (await page.request.post(`/api/projects/${project.id}/timeline-media/thumbnails`, { data: {} })).json();
    expect(duplicate.id).toBe(task.id);
    expect((await page.request.get(`/api/projects/${project.id}/timeline-artifacts/${task.id}`)).status()).toBe(409);
    await expect(page.getByRole('status', { name: '缩略图任务状态' })).toContainText('运行中');
    await expect(page.locator('.locked img')).toHaveCount(0);
    await expect.poll(() => intermediate().length).toBeGreaterThanOrEqual(2);
    const [first, second] = intermediate();
    expect(second.processed_frames).toBeGreaterThan(first.processed_frames);
    expect(second.progress_source).toBe('sampled_frames');
    expect(second.progress).toBeCloseTo(second.processed_frames / 240, 6);
    await expect(page.getByRole('progressbar', { name: '缩略图生成进度' })).toHaveAttribute('value', String(second.progress));
    await page.screenshot({ path: '../tests/evidence/ticket-12-running-progress.jpg' });
    inspected = true; release();
    await expect(page.getByRole('status', { name: '缩略图任务状态' })).toContainText('成功', { timeout: 30000 });
    await expect(page.locator('.locked img').first()).toBeVisible();
    const completed = await (await page.request.get(`/api/projects/${project.id}/tasks/${task.id}`)).json();
    expect(completed.processed_frames).toBe(240);
    const disk = await (await page.request.get(`/api/projects/${project.id}`)).json();
    expect(disk.entries).toEqual(project.entries); expect(disk.revision).toBe(1);
    await fs.writeFile('../tests/evidence/ticket-12-progress.json', JSON.stringify({ project: project.id, task: task.id, observations, duration_ms: disk.media.duration_ms, cached: disk.media_artifacts }, null, 2));
  } finally {
    inspected = true; release();
    const completed = await (await page.request.get(`/api/projects/${project.id}/tasks/${task.id}`)).json();
    await fs.mkdir('.test-workspace/progress-diagnosis', { recursive: true });
    await fs.writeFile(`.test-workspace/progress-diagnosis/${project.id}.json`, JSON.stringify({ project: project.id, submitted: task, observations, completed }, null, 2));
  }
});
