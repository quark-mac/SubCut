import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/api';

const inputs = path.resolve('.test-workspace/inputs');
async function open(page: Page, name: string) {
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function fixture(page: Page) {
  const subtitle = path.join(inputs, '结构.jsonl');
  await fs.writeFile(subtitle, [
    { idx: 90, start: 6, end: 7, speaker: '乙', text: '后句', tags: ['MERGED'], source_entries: [70] },
    { idx: 12, start: 1, end: 3, speaker: '甲', text: '完整长句\n第二行', tags: ['MULTI'], source_entries: [9, 9, 2] },
    { idx: 13, start: 1, end: 3, speaker: '甲', text: '同时间', tags: ['MERGED'], source_entries: [3] },
    { idx: 14, start: 4, end: 5, speaker: '甲', text: '间隙之后', tags: ['MULTI', 'CUSTOM'], source_entries: [8, 0] },
  ].map(e => JSON.stringify(e)).join('\n'));
  const response = await page.request.post('/api/projects', { data: {
    name: `结构-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl',
  } });
  expect(response.status()).toBe(201);
  const project: Project = await response.json();
  await page.goto('/'); await open(page, project.name);
  return project;
}
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const row = (page: Page, n: number) => button(page, `列表字幕 ${n}`);
const disk = async (page: Page, p: Project): Promise<Project> => (await page.request.get(`/api/projects/${p.id}`)).json();
async function settled(page: Page, p: Project) {
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
  return disk(page, p);
}
async function seek(page: Page, ms: number) {
  const ruler = page.getByLabel('原片时间刻度', { exact: true });
  const rect = (await ruler.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 12);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * ms / 8000, rect.y + 12);
  await page.mouse.up();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
}

test('新增片头默认两秒和未知归属，空白及取消不落盘，提交一步历史且无虚构来源', async ({ page }) => {
  const original = await fixture(page);
  await button(page, '新增字幕').click();
  await expect(page.getByRole('dialog')).toContainText('00:00:00.000 → 00:00:02.000');
  await expect(page.getByLabel('新增说话人归属')).toHaveValue(original.speakers.find(s => s.label === '?')!.id);
  await expect(button(page, '确认新增')).toBeDisabled();
  await page.getByLabel('新增字幕正文').fill('   ');
  await expect(button(page, '确认新增')).toBeDisabled();
  await page.waitForTimeout(750);
  expect(await disk(page, original)).toEqual(original);
  await button(page, '取消新增').click();
  await expect(button(page, '撤销')).toBeDisabled();
  await button(page, '新增字幕').click();
  await page.getByLabel('新增字幕正文').fill('补上的台词\n完整换行');
  await button(page, '确认新增').click();
  const result = await settled(page, original);
  expect(result.entries.slice(0, 4)).toEqual(original.entries);
  const added = result.entries[4];
  expect(added).toEqual({ id: expect.any(String), start_ms: 0, end_ms: 2000, text: '补上的台词\n完整换行', speaker_id: original.speakers.find(s => s.label === '?')!.id, tags: [], sources: [] });
  expect(original.entries.map(e => e.id)).not.toContain(added.id);
  await expect(row(page, 1)).toContainText('补上的台词');
  await expect(button(page, '字幕总览：补上的台词\n完整换行')).toHaveCount(1);
  await expect(button(page, '未标注 ?：补上的台词\n完整换行')).toHaveCount(1);
  await button(page, '撤销').click();
  expect((await settled(page, original)).entries).toEqual(original.entries);
  await expect(button(page, '撤销')).toBeDisabled();
  await button(page, '新增字幕').click();
  await page.getByLabel('新增字幕正文').fill('取消内容');
  await page.keyboard.press('Escape');
  await expect(button(page, '重做')).toBeEnabled();
  await button(page, '重做').click();
  expect((await settled(page, original)).entries).toEqual(result.entries);
});

test('明确轨道新增普通位置两秒、片尾缩短，媒体终点拒绝零时长，重开保持', async ({ page }) => {
  const original = await fixture(page);
  const speaker = original.speakers.find(s => s.label === '乙')!;
  await page.getByLabel('当前说话人轨', { exact: true }).selectOption(speaker.id);
  for (const ms of [4000, 7500]) {
    await seek(page, ms);
    const start = Math.round(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime) * 1000);
    expect(Math.abs(start - ms)).toBeLessThanOrEqual(1);
    await button(page, '新增字幕').click();
    await expect(page.getByLabel('新增说话人归属')).toHaveValue(speaker.id);
    await page.getByLabel('新增字幕正文').fill(`补充 ${ms}`);
    await button(page, '确认新增').click();
    const p = await settled(page, original);
    expect(p.entries.at(-1)).toEqual({ id: expect.any(String), start_ms: start, end_ms: ms === 4000 ? start + 2000 : 8000, text: `补充 ${ms}`, speaker_id: speaker.id, tags: [], sources: [] });
  }
  await seek(page, 8000);
  await expect(button(page, '新增字幕')).toBeDisabled();
  const saved = await settled(page, original);
  expect(saved.entries).toHaveLength(6);
  await page.reload(); await open(page, original.name);
  expect((await disk(page, original)).entries).toEqual(saved.entries);
  await expect(button(page, '撤销')).toBeDisabled();
});

test('拆分严格内部单选，快捷键复制两段全文与来源元标签，一步撤销恢复原身份', async ({ page }) => {
  const original = await fixture(page);
  await row(page, 1).click();
  await expect(button(page, '拆分字幕')).toBeDisabled();
  await page.keyboard.press('Control+b');
  await expect(button(page, '撤销')).toBeDisabled();
  await seek(page, 3000);
  await expect(button(page, '拆分字幕')).toBeDisabled();
  await page.keyboard.press('Control+b');
  await seek(page, 2000);
  await expect(button(page, '拆分字幕')).toBeEnabled();
  await row(page, 2).click({ modifiers: ['Control'] });
  await expect(button(page, '拆分字幕')).toBeDisabled();
  await page.keyboard.press('Control+b');
  expect(await disk(page, original)).toEqual(original);
  await row(page, 2).click({ modifiers: ['Control'] });
  await page.getByLabel('字幕正文').focus();
  await page.keyboard.press('Control+b');
  expect(await disk(page, original)).toEqual(original);
  await row(page, 1).focus();
  await page.keyboard.press('Control+b');
  const split = await settled(page, original);
  expect(split.entries).toHaveLength(5);
  const copies = split.entries.filter(e => e.text === '完整长句\n第二行');
  expect(copies).toHaveLength(2);
  expect(copies[0]).toEqual({ ...original.entries[1], id: expect.any(String), end_ms: 2000 });
  expect(copies[1]).toEqual({ ...original.entries[1], id: expect.any(String), start_ms: 2000 });
  expect(copies[0].id).not.toBe(copies[1].id);
  expect(split.entries.filter(e => e.text !== '完整长句\n第二行')).toEqual(original.entries.filter(e => e.id !== original.entries[1].id));
  await expect(button(page, '字幕总览：完整长句\n第二行')).toHaveCount(2);
  await expect(button(page, '甲：完整长句\n第二行')).toHaveCount(2);
  await button(page, '撤销').click();
  expect((await settled(page, original)).entries).toEqual(original.entries);
  await expect(button(page, '撤销')).toBeDisabled();
  await button(page, '重做').click();
  expect((await settled(page, original)).entries).toEqual(split.entries);
});

test('合并必须在全体工作字幕中连续，同人重叠和间隙按稳定顺序合并且保留来源', async ({ page }) => {
  const original = await fixture(page);
  await row(page, 1).click();
  await expect(button(page, '合并字幕')).toBeDisabled();
  await row(page, 3).click({ modifiers: ['Control'] });
  await expect(button(page, '合并字幕')).toBeDisabled();
  await page.keyboard.press('Control+m');
  expect(await disk(page, original)).toEqual(original);
  await expect(button(page, '撤销')).toBeDisabled();
  await row(page, 2).click({ modifiers: ['Control'] });
  await expect(button(page, '合并字幕')).toBeEnabled();
  await button(page, '合并字幕').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const merged = await settled(page, original);
  expect(merged.entries).toHaveLength(2);
  expect(merged.entries[0]).toEqual(original.entries[0]);
  expect(merged.entries[1]).toEqual({ id: expect.any(String), start_ms: 1000, end_ms: 5000, text: '完整长句\n第二行\n同时间\n间隙之后', speaker_id: original.entries[1].speaker_id, tags: ['MULTI', 'MERGED', 'CUSTOM'], sources: [...original.entries[1].sources, ...original.entries[2].sources, ...original.entries[3].sources] });
  expect(original.entries.map(e => e.id)).not.toContain(merged.entries[1].id);
  await expect(page.getByLabel('字幕正文')).toHaveValue('完整长句\n第二行\n同时间\n间隙之后');
  await button(page, '撤销').click();
  expect((await settled(page, original)).entries).toEqual(original.entries);
  await expect(button(page, '撤销')).toBeDisabled();
  await button(page, '重做').click();
  expect((await settled(page, original)).entries).toEqual(merged.entries);
});

test('跨人快捷键合并须明确选择目标，选择与取消不改工程历史，确认完整一步撤销', async ({ page }) => {
  const original = await fixture(page);
  await row(page, 3).click();
  await row(page, 4).click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+m');
  await expect(page.getByRole('dialog')).toContainText('跨说话人合并');
  await expect(page.getByLabel('合并结果说话人')).toHaveValue('');
  await expect(button(page, '确认合并字幕')).toBeDisabled();
  await page.getByLabel('合并结果说话人').selectOption(original.speakers.find(s => s.label === '?')!.id);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(750);
  expect(await disk(page, original)).toEqual(original);
  await button(page, '取消合并').click();
  await expect(button(page, '撤销')).toBeDisabled();
  await row(page, 3).focus();
  await page.keyboard.press('Control+m');
  await expect(page.getByLabel('合并结果说话人')).toHaveValue('');
  await page.getByLabel('合并结果说话人').selectOption(original.speakers.find(s => s.label === '乙')!.id);
  await button(page, '确认合并字幕').click();
  const merged = await settled(page, original);
  expect(merged.entries).toHaveLength(3);
  const entry = merged.entries.find(e => e.text === '间隙之后\n后句')!;
  expect(entry).toEqual({ id: expect.any(String), start_ms: 4000, end_ms: 7000, text: '间隙之后\n后句', speaker_id: original.entries[0].speaker_id, tags: ['MULTI', 'CUSTOM', 'MERGED'], sources: [...original.entries[3].sources, ...original.entries[0].sources] });
  expect(merged.entries.filter(e => e.id !== entry.id)).toEqual(original.entries.slice(1, 3));
  await button(page, '撤销').click();
  expect((await settled(page, original)).entries).toEqual(original.entries);
  await expect(button(page, '撤销')).toBeDisabled();
  await row(page, 3).click(); await row(page, 4).click({ modifiers: ['Control'] });
  await button(page, '合并字幕').click(); await page.keyboard.press('Escape');
  await expect(button(page, '重做')).toBeEnabled();
  await button(page, '重做').click();
  expect((await settled(page, original)).entries).toEqual(merged.entries);
});

test('新增拆分合并保存重开后四格式实际文件排序、重新编号、元标签与来源保持一致', async ({ page }) => {
  const original = await fixture(page);
  const sourceText = await fs.readFile(original.subtitle_sources[0].path, 'utf8');
  await row(page, 1).click(); await seek(page, 2000);
  await button(page, '拆分字幕').click();
  await expect(page.locator('.subtitle-row')).toHaveCount(5);
  // The other 1–3s entry lies between the split halves in the full ordering.
  await expect(button(page, '合并字幕')).toBeDisabled();
  await page.keyboard.press('Control+m');
  await row(page, 4).click(); await row(page, 5).click({ modifiers: ['Control'] });
  await button(page, '合并字幕').click();
  await page.getByLabel('合并结果说话人').selectOption(original.speakers.find(s => s.label === '?')!.id);
  await button(page, '确认合并字幕').click();
  await seek(page, 0); await button(page, '新增字幕').click();
  await page.getByLabel('新增字幕正文').fill('片头补充'); await button(page, '确认新增').click();
  const edited = await settled(page, original);
  await page.reload(); await open(page, original.name);
  await expect(button(page, '撤销')).toBeDisabled();
  expect((await disk(page, original)).entries).toEqual(edited.entries);
  expect((await disk(page, original)).subtitle_sources).toEqual(original.subtitle_sources);
  const labels = { 'speaker-srt': '说话人 SRT', 'plain-srt': '普通 SRT', 'normalized-jsonl': '项目 JSONL', 'moss-json': 'MOSS JSON' };
  const outputs: Record<string, string> = {};
  const exportFiles: string[] = [];
  for (const [format, label] of Object.entries(labels)) {
    await page.getByLabel('导出格式').selectOption(format);
    const response = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
    await button(page, `导出${label}`).click();
    const result = await (await response).json();
    await expect(page.getByRole('link', { name: result.export.filename })).toBeVisible();
    outputs[format] = await fs.readFile(result.export.path, 'utf8');
    exportFiles.push(result.export.path);
    expect(await (await page.request.get(result.url)).text()).toBe(outputs[format]);
  }
  expect(outputs['speaker-srt']).toBe('1\n00:00:00,000 --> 00:00:02,000\n[?] 片头补充\n\n2\n00:00:01,000 --> 00:00:02,000\n[甲] 完整长句\n第二行\n\n3\n00:00:01,000 --> 00:00:03,000\n[甲] 同时间\n\n4\n00:00:02,000 --> 00:00:03,000\n[甲] 完整长句\n第二行\n\n5\n00:00:04,000 --> 00:00:07,000\n[?] 间隙之后\n后句\n');
  expect(outputs['plain-srt']).toBe('1\n00:00:00,000 --> 00:00:02,000\n片头补充\n\n2\n00:00:01,000 --> 00:00:02,000\n完整长句\n第二行\n\n3\n00:00:01,000 --> 00:00:03,000\n同时间\n\n4\n00:00:02,000 --> 00:00:03,000\n完整长句\n第二行\n\n5\n00:00:04,000 --> 00:00:07,000\n间隙之后\n后句\n');
  const jsonl = outputs['normalized-jsonl'].trim().split('\n').map(line => JSON.parse(line));
  expect(jsonl).toEqual([
    { idx: 1, start: 0, end: 2, speaker: '?', text: '片头补充', tags: [], source_entries: [] },
    { idx: 2, start: 1, end: 2, speaker: '甲', text: '完整长句\n第二行', tags: ['MULTI'], source_entries: [9, 9, 2] },
    { idx: 3, start: 1, end: 3, speaker: '甲', text: '同时间', tags: ['MERGED'], source_entries: [3] },
    { idx: 4, start: 2, end: 3, speaker: '甲', text: '完整长句\n第二行', tags: ['MULTI'], source_entries: [9, 9, 2] },
    { idx: 5, start: 4, end: 7, speaker: '?', text: '间隙之后\n后句', tags: ['MULTI', 'CUSTOM', 'MERGED'], source_entries: [8, 0, 70] },
  ]);
  const moss = JSON.parse(outputs['moss-json']);
  expect(new Set(moss.map((e: { id: string }) => e.id)).size).toBe(5);
  expect(moss.map((e: { id: string }) => e.id).sort()).toEqual(edited.entries.map(e => e.id).sort());
  expect(moss.map(({ id: _id, ...e }: { id: string }) => e)).toEqual(jsonl.map(({ idx: _idx, tags: _tags, source_entries: _sources, ...e }) => e));
  await page.getByLabel('导出格式').selectOption('speaker-srt'); await page.getByLabel('保留已有元标签').check();
  const taggedResponse = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
  await button(page, '导出说话人 SRT').click();
  const tagged = await (await taggedResponse).json();
  expect(await fs.readFile(tagged.export.path, 'utf8')).toContain('[?] {MULTI} {CUSTOM} {MERGED} 间隙之后\n后句');
  const after = await disk(page, original);
  expect(after.entries).toEqual(edited.entries);
  expect(after.entries.flatMap(e => e.sources.map(s => s.index))).toEqual([12, 12, 13, 14, 90]);
  expect(await fs.readFile(original.subtitle_sources[0].path, 'utf8')).toBe(sourceText);
  await row(page, 5).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await fs.mkdir('../tests/evidence', { recursive: true });
  await page.screenshot({ path: '../tests/evidence/ticket-08-structure-editing.jpg', type: 'jpeg', quality: 85, fullPage: true });
  await fs.writeFile(path.resolve('.test-workspace/ticket-08-artifacts.json'), JSON.stringify({ project: after.id, files: [...exportFiles, tagged.export.path] }, null, 2));
});

test('同人物轨中看似相邻仍按全体排序校验，嵌套重叠合并取最晚结束', async ({ page }) => {
  const original = await fixture(page);
  const entries = original.entries.map((e, i) => i === 1 ? { ...e, end_ms: 7000 } : i === 2 ? { ...e, start_ms: 2000, speaker_id: original.entries[0].speaker_id } : e);
  const response = await page.request.put(`/api/projects/${original.id}`, { data: { revision: original.revision, name: original.name, entries } });
  expect(response.ok()).toBeTruthy();
  await page.reload(); await open(page, original.name);
  await button(page, '甲：完整长句\n第二行').click();
  await button(page, '甲：间隙之后').click({ modifiers: ['Control'] });
  await expect(button(page, '合并字幕')).toBeDisabled();
  await page.keyboard.press('Control+m');
  expect((await disk(page, original)).entries).toEqual(entries);
  await expect(button(page, '撤销')).toBeDisabled();
  await row(page, 2).click({ modifiers: ['Control'] });
  await button(page, '合并字幕').click();
  await page.getByLabel('合并结果说话人').selectOption(original.entries[1].speaker_id);
  await button(page, '确认合并字幕').click();
  const result = await settled(page, original);
  const merged = result.entries.find(e => e.text.startsWith('完整长句'))!;
  expect(merged.start_ms).toBe(1000);
  expect(merged.end_ms).toBe(7000); // Last selected row ends at 5s, first row ends at 7s.
  expect(merged.text).toBe('完整长句\n第二行\n同时间\n间隙之后');
  await button(page, '撤销').click();
  expect((await settled(page, original)).entries).toEqual(entries);
});

test('明确点击人物轨标题可在空轨新增，选择总览清除归属目标，不以字幕选择猜测人物', async ({ page }) => {
  const original = await fixture(page);
  await button(page, '选择轨道 非对白 NONSPEECH').click();
  await button(page, '新增字幕').click();
  await expect(page.getByLabel('新增说话人归属')).toHaveValue(original.speakers.find(s => s.label === 'NONSPEECH')!.id);
  await button(page, '取消新增').click();
  await button(page, '选择轨道 字幕总览').click();
  await row(page, 1).click();
  await button(page, '新增字幕').click();
  await expect(page.getByLabel('新增说话人归属')).toHaveValue(original.speakers.find(s => s.label === '?')!.id);
  await page.keyboard.press('Escape');
  await expect(button(page, '撤销')).toBeDisabled();
  expect(await disk(page, original)).toEqual(original);
});

test('MOSS 重复来源 ID 经拆分合并仍保留，输出身份唯一且不伪造原来源索引', async ({ page }) => {
  const subtitle = path.join(inputs, '结构-moss.json');
  await fs.writeFile(subtitle, JSON.stringify([
    { id: 'source-72', start: 1, end: 3, speaker: 'S00', text: '原文\n第二行' },
    { id: 'source-72', start: 4, end: 5, speaker: 'S00', text: '另一条' },
  ]));
  const response = await page.request.post('/api/projects', { data: { name: `结构MOSS-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'moss-json' } });
  expect(response.status()).toBe(201);
  const original: Project = await response.json();
  await page.goto('/'); await open(page, original.name);
  await row(page, 1).click(); await seek(page, 2000); await button(page, '拆分字幕').click();
  const split = await settled(page, original);
  expect(split.entries.slice(0, 2).map(e => e.sources)).toEqual([original.entries[0].sources, original.entries[0].sources]);
  await button(page, '合并字幕').click();
  const merged = await settled(page, original);
  expect(merged.entries[0].text).toBe('原文\n第二行\n原文\n第二行');
  expect(merged.entries[0].sources).toEqual([...original.entries[0].sources, ...original.entries[0].sources]);
  await button(page, '撤销').click();
  expect((await settled(page, original)).entries).toEqual(split.entries);
  await button(page, '撤销').click();
  expect((await settled(page, original)).entries).toEqual(original.entries);
  await expect(button(page, '撤销')).toBeDisabled();
  await button(page, '重做').click(); await button(page, '重做').click();
  expect((await settled(page, original)).entries).toEqual(merged.entries);
  for (const [format, label] of [['moss-json', 'MOSS JSON'], ['normalized-jsonl', '项目 JSONL']]) {
    await page.getByLabel('导出格式').selectOption(format);
    const response = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
    await button(page, `导出${label}`).click();
    const output = await (await response).json();
    const text = await fs.readFile(output.export.path, 'utf8');
    if (format === 'moss-json') {
      const moss = JSON.parse(text);
      expect(moss.map((e: { id: string }) => e.id)).toEqual(merged.entries.map(e => e.id));
      expect(new Set(moss.map((e: { id: string }) => e.id)).size).toBe(2);
      expect(moss[0].id).not.toBe('source-72');
    } else expect(text.trim().split('\n').map(line => JSON.parse(line).source_entries)).toEqual([[], []]);
  }
});
