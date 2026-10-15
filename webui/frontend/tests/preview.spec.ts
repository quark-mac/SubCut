import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import type { Project } from '../src/api';

const root = path.resolve('.test-workspace/preview');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function open(page: Page, name: string) {
  await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, name).click();
}
async function fixture(page: Page, large = false) {
  const folder = path.join(root, String(Date.now()));
  execFileSync(process.env.WEBUI_PYTHON || 'python', ['-c',
    'from pathlib import Path; from webui.tests.fixtures import create_preview_fixture; import sys; create_preview_fixture(Path(sys.argv[1]), offset=5)', folder], { cwd: '../..' });
  const media = path.join(folder, large ? 'large.mkv' : 'markers-offset-5-silent-False.mkv');
  if (large) execFileSync('ffmpeg', ['-v', 'error', '-y', '-stream_loop', '5', '-i', path.join(folder, 'markers-offset-5-silent-False.mkv'), '-vf', 'scale=1280:720', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-t', '54', media]);
  await page.goto('/'); await button(page, '新建工程').click();
  await page.getByLabel('工程名称', { exact: true }).fill(`兼容预览-${Date.now()}`);
  await page.getByLabel('视频绝对路径', { exact: true }).fill(media);
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(path.join(folder, 'markers.srt'));
  await button(page, '解析预览').click();
  const created = page.waitForResponse(r => r.url().endsWith('/api/projects') && r.request().method() === 'POST');
  await button(page, '创建工程').click();
  return (await (await created).json()) as Project;
}

test('真实不兼容原片从 UI 转换，Edge 解码并在开头中部结尾保持音画字幕及缓存', async ({ page, browser }) => {
  const project = await fixture(page);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.error !== null || (v.readyState >= 2 && v.videoWidth === 0))).toBe(true);
  await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('解码失败');
  await expect(page.getByText(/matroska.*ffv1.*pcm_s16le/)).toBeVisible();
  await expect(button(page, '列表字幕 3')).toContainText('结尾');
  await button(page, '生成预览副本').click();
  await expect(page.getByRole('status', { name: '预览任务状态' })).toContainText('等待');
  await expect(page.getByRole('status', { name: '预览任务状态' })).toContainText('成功');
  await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const results: unknown[] = [];
  for (const [seconds, rgb, label, hz] of [[1, [255, 0, 0], '红色', 440], [5, [0, 255, 0], '绿色', 880], [8.5, [0, 0, 255], '蓝色', 1320]] as const) {
    await page.getByLabel('跳转时间', { exact: true }).fill(String(seconds)); await button(page, '跳转').click();
    await expect(page.locator('.subtitle-overlay')).toContainText(label);
    const observed = await page.locator('video').evaluate(async (v: HTMLVideoElement) => {
      if (v.seeking) await new Promise(resolve => v.addEventListener('seeked', resolve, { once: true }));
      const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(v, 0, 0, 4, 4);
      const pixel = Array.from(ctx.getImageData(1, 1, 1, 1).data);
      const context = new AudioContext();
      // Decode the actual served MP4 audio in Edge, then sample at the same source time.
      const audio = await context.decodeAudioData(await (await fetch(v.currentSrc)).arrayBuffer());
      const start = Math.round(v.currentTime * audio.sampleRate);
      const samples = audio.getChannelData(0).slice(start, start + Math.round(audio.sampleRate / 10));
      let crossings = 0, power = 0;
      for (let i = 1; i < samples.length; i++) { if (samples[i - 1] <= 0 && samples[i] > 0) crossings++; power += samples[i] ** 2; }
      await context.close();
      return { time: v.currentTime, pixel, hz: crossings * 10, rms: Math.sqrt(power / samples.length), duration: v.duration, url: v.currentSrc };
    });
    expect(observed.time).toBeCloseTo(seconds, 2);
    rgb.forEach((channel, i) => expect(Math.abs(observed.pixel[i] - channel)).toBeLessThan(10));
    expect(Math.abs(observed.hz - hz)).toBeLessThanOrEqual(20); expect(observed.rms).toBeGreaterThan(.2);
    expect(observed.duration).toBeCloseTo(9, 1);
    results.push(observed);
    await page.screenshot({ path: `../tests/evidence/ticket-11-${seconds}s.jpg` });
  }
  await button(page, '列表字幕 1').dblclick();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused && Math.abs(v.currentTime - 1.8) < .03)).toBe(true);
  await button(page, '循环当前字幕').click(); await page.getByLabel('播放速度').selectOption('2');
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime < 1.8)).toBe(true);
  await button(page, '退出试听').click();
  const before = await (await page.request.get(`/api/projects/${project.id}`)).json();
  expect(before.media).toEqual(project.media); expect(before.entries).toEqual(project.entries);
  expect(before.media_artifacts).toHaveLength(1);
  await page.reload(); await open(page, project.name);
  await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
  expect(await page.locator('video').getAttribute('src')).toContain(before.media_artifacts[0].id);
  const ranged = await page.request.get((await page.locator('video').getAttribute('src'))!, { headers: { Range: 'bytes=100-299' } });
  expect(ranged.status()).toBe(206);
  await page.getByLabel('预览质量', { exact: true }).selectOption('small');
  await expect.poll(() => page.locator('video').getAttribute('src')).not.toContain('/previews/');
  const smallSubmitted = page.waitForResponse(r => r.url().endsWith(`/projects/${project.id}/preview`) && r.request().method() === 'POST');
  await button(page, '生成预览副本').click();
  const smallTask = await (await smallSubmitted).json();
  expect(smallTask.parameters.quality).toBe('small');
  await expect(page.getByRole('status', { name: '预览任务状态' })).toContainText('成功');
  await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
  await expect(page.locator('video')).toHaveAttribute('src', new RegExp(`/previews/${smallTask.id}`));
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(320);
  await page.getByLabel('预览质量', { exact: true }).selectOption('standard');
  await expect.poll(() => page.locator('video').getAttribute('src')).toContain(before.media_artifacts[0].id);
  await fs.writeFile('../tests/evidence/ticket-11-playback.json', JSON.stringify({ browser: browser.version(), project: before, observations: results }, null, 2));
});

test('质量切换的旧播放查询晚于生成回执时，仍跟踪当前任务并解码新副本', async ({ page }, testInfo) => {
  const project = await fixture(page);
  await button(page, '生成预览副本').click();
  await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
  const events = await page.evaluateHandle(() => {
    const observations: object[] = [];
    for (const name of ['loadedmetadata', 'loadeddata', 'error']) document.addEventListener(name, event => {
      const video = event.target;
      if (video instanceof HTMLVideoElement) observations.push({ event: name, src: video.currentSrc, width: video.videoWidth, readyState: video.readyState });
    }, true);
    return observations;
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let captured!: () => void;
  const capturedResponse = new Promise<void>(resolve => { captured = resolve; });
  let first = true;
  let stale: { preview: unknown; task: { id: string; state: string; parameters: { quality: string } } } | undefined;
  await page.route(`**/api/projects/${project.id}/playback?quality=small`, async route => {
    if (!first) { await route.continue(); return; }
    first = false;
    const response = await route.fetch(); stale = await response.json(); captured();
    await gate; await route.fulfill({ response });
  });
  try {
    await page.getByLabel('预览质量', { exact: true }).selectOption('small');
    await capturedResponse;
    expect(stale?.preview).toBeNull();
    expect(stale?.task.parameters.quality).toBe('standard');
    const submitted = page.waitForResponse(r => r.url().endsWith(`/projects/${project.id}/preview`) && r.request().method() === 'POST');
    await button(page, '生成预览副本').click();
    const task = await (await submitted).json();
    expect(task.parameters.quality).toBe('small');
    await expect(page.getByRole('status', { name: '预览任务状态' })).toContainText('等待');
    release(); // Deliver the real pre-submission GET only after the new task was acknowledged.
    await expect.poll(async () => (await (await page.request.get(`/api/projects/${project.id}/tasks/${task.id}`)).json()).state).toBe('succeeded');
    try {
      await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
      await expect(page.locator('video')).toHaveAttribute('src', new RegExp(`/previews/${task.id}`));
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(320);
    } finally {
      const observation = JSON.stringify({ stale, submitted: task,
        completed: await (await page.request.get(`/api/projects/${project.id}/tasks/${task.id}`)).json(),
        displayedTask: await page.getByRole('status', { name: '预览任务状态' }).textContent(),
        displayedDecoder: await page.getByRole('status', { name: '浏览器解码状态' }).textContent(),
        video: await page.locator('video').evaluate((v: HTMLVideoElement) => ({ src: v.currentSrc, width: v.videoWidth, readyState: v.readyState })),
        events: await events.jsonValue() }, null, 2);
      await fs.mkdir('.test-workspace/quality-switch-diagnosis', { recursive: true });
      await fs.writeFile('.test-workspace/quality-switch-diagnosis/latest-race.json', observation);
      await testInfo.attach('quality-response-order.json', { contentType: 'application/json', body: observation });
    }
  } finally { release(); }
});

test('后台完成与自动保存回执交错，切换后旧任务回执不覆盖新工程或草稿', async ({ page }) => {
  test.setTimeout(60000);
  const project = await fixture(page, true);
  const other: Project = await (await page.request.post(`/api/projects/${project.id}/save-as`, { data: { revision: 1, name: `${project.name}-另一工程` } })).json();
  let releaseTask!: () => void;
  const taskGate = new Promise<void>(resolve => { releaseTask = resolve; });
  let finished!: () => void;
  const taskFinished = new Promise<void>(resolve => { finished = resolve; });
  const observed: { state: string; progress: number }[] = [];
  let pendingProof = false;
  await page.route(`**/api/projects/${project.id}/tasks/*`, async route => {
    const response = await route.fetch(); const task = await response.json();
    observed.push({ state: task.state, progress: task.progress });
    if (!pendingProof && task.state === 'running' && task.progress > 0 && task.progress < .6) {
      expect((await fs.stat(task.command[task.command.length - 1])).size).toBeGreaterThan(0);
      expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).media_artifacts).toEqual([]);
      expect((await page.request.get(`/api/projects/${project.id}/previews/${task.id}`)).status()).toBe(409);
      pendingProof = true;
    }
    if (task.state === 'succeeded') { finished(); await taskGate; }
    await route.fulfill({ response });
  });
  await button(page, '生成预览副本').click();
  await expect(page.getByRole('status', { name: '预览任务状态' })).toContainText('运行中');
  await button(page, '列表字幕 1').click();
  const editor = page.getByRole('textbox', { name: '字幕正文', exact: true });
  let releaseSave!: () => void;
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  let savedOnDisk!: () => void;
  const savedBeforeResponse = new Promise<void>(resolve => { savedOnDisk = resolve; });
  let held = false;
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'PUT' || held) { await route.continue(); return; }
    held = true;
    const response = await route.fetch(); savedOnDisk(); await saveGate; await route.fulfill({ response });
  });
  await editor.fill('自动保存第一代'); await button(page, '应用修改').click();
  await savedBeforeResponse;
  await editor.fill('任务完成时的新草稿');
  await taskFinished;
  await expect(editor).toHaveValue('任务完成时的新草稿');
  releaseSave();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('未保存');
  // Opening another project commits the newer draft before changing sessions.
  await open(page, other.name);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(other.name);
  await button(page, '列表字幕 1').click(); await editor.fill('另一工程独立草稿');
  releaseTask();
  await page.waitForTimeout(400);
  await expect(editor).toHaveValue('另一工程独立草稿');
  expect(await page.locator('video').getAttribute('src')).toContain(other.id);
  await button(page, '保存工程').click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  const disk = await (await page.request.get(`/api/projects/${project.id}`)).json();
  const second = await (await page.request.get(`/api/projects/${other.id}`)).json();
  expect(disk.entries[0].text).toBe('任务完成时的新草稿'); expect(disk.media_artifacts).toHaveLength(1);
  expect(second.entries[0].text).toBe('另一工程独立草稿'); expect(second.media_artifacts).toEqual([]);
  expect(observed.some(task => task.state === 'running' && task.progress > 0 && task.progress < 1)).toBe(true);
  expect(pendingProof).toBe(true);
  await open(page, project.name);
  await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
  await expect(button(page, '列表字幕 1')).toContainText('任务完成时的新草稿');
  await fs.writeFile('../tests/evidence/ticket-11-concurrency.json', JSON.stringify({ observed, pendingProof, first: disk.id, second: second.id, firstText: disk.entries[0].text, secondText: second.entries[0].text, artifacts: disk.media_artifacts }, null, 2));
});

test('真实缺工具及 FFmpeg 失败显示原因，补齐工具后从 UI 重试成功且已保存字幕保留', async ({ browser }) => {
  test.setTimeout(60000);
  const folder = path.join(root, `tools-${Date.now()}`); await fs.mkdir(folder, { recursive: true });
  const executable = path.join(folder, 'configured-ffmpeg.exe');
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
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
    await button(page, '列表字幕 1').click();
    await page.getByRole('textbox', { name: '字幕正文', exact: true }).fill('工具失败前保存的字幕');
    await button(page, '生成预览副本').click();
    await expect(page.getByRole('status', { name: '预览任务状态' })).toContainText('失败');
    await expect(page.getByRole('alert')).toContainText('未找到 ffmpeg');
    const missing = await (await page.request.get(`/api/projects/${project.id}`)).json();
    expect(missing.entries[0].text).toBe('工具失败前保存的字幕'); expect(missing.media_artifacts).toEqual([]);
    const locate = (name: string) => execFileSync('where.exe', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    await fs.copyFile(locate('ffprobe'), executable); // Real external tool, deliberately wrong program.
    await button(page, '重试生成预览副本').click();
    await expect(page.getByRole('alert')).toContainText('FFmpeg 生成失败');
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).media_artifacts).toEqual([]);
    const ffmpeg = locate('ffmpeg');
    await expect(async () => { await fs.rm(executable, { force: true }); await fs.copyFile(ffmpeg, executable); }).toPass({ timeout: 5000 });
    await button(page, '重试生成预览副本').click();
    await expect(page.getByRole('status', { name: '预览任务状态' })).toContainText('成功');
    await expect(page.getByRole('status', { name: '浏览器解码状态' })).toContainText('已解码');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const recovered = await (await page.request.get(`/api/projects/${project.id}`)).json();
    expect(recovered.entries).toEqual(missing.entries); expect(recovered.media_artifacts).toHaveLength(1);
    await page.screenshot({ path: '../tests/evidence/ticket-11-retry.jpg' });
  } finally {
    await context.close(); service.kill();
    await new Promise<void>(resolve => service.once('exit', () => resolve()));
    await fs.writeFile(path.join(folder, 'server.log'), logs);
    // Only this test-owned executable is transient; media artifacts remain inspectable.
    await fs.rm(executable, { force: true });
  }
});
