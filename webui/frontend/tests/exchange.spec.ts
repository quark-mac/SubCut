import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const inputs = path.resolve('.test-workspace/inputs');
const rows = [
  { idx: 90, start: 3, end: 4, speaker: 'NONSPEECH', text: '后面的声音', tags: [], source_entries: [77] },
  { idx: 8, start: 1.25, end: 2.75, speaker: 'Iroha&Kaguya', text: '甲\n乙', tags: ['MULTI', 'MERGED'], source_entries: [91, 0, 91] },
  { idx: 7, start: 1.25, end: 2.75, speaker: '?', text: '同时间', tags: [], source_entries: [] },
];

async function openProject(page: Page, name: string) {
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '打开工程…' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function fixture(page: Page) {
  const response = await page.request.post('/api/projects', { data: {
    name: `交换-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: path.join(inputs, '来源.srt'),
  } });
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto('/');
  await openProject(page, project.name);
  return project;
}

async function save(page: Page) {
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存');
}

test('完整预览后替换一步撤销与重做，身份来源标签及人物完整恢复并保存重开', async ({ page }) => {
  const original = await fixture(page);
  const subtitle = path.join(inputs, '替换.jsonl');
  await fs.writeFile(subtitle, rows.map(row => JSON.stringify(row)).join('\n'));
  const disk = async () => (await page.request.get(`/api/projects/${original.id}`)).json();
  await page.getByRole('button', { name: '替换字幕', exact: true }).click();
  await page.getByLabel('导入格式').selectOption('normalized-jsonl');
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(subtitle);
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog')).toContainText('Iroha&Kaguya');
  await expect(page.getByRole('dialog')).toContainText('91, 0, 91');
  expect(await disk()).toEqual(original); // Preview has no persistence side effect.
  await page.getByRole('button', { name: '应用替换', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: '列表字幕 1', exact: true })).toContainText('甲');
  await save(page);
  const replaced = await disk();
  expect(replaced.entries[1].sources[0].source_entries).toEqual([91, 0, 91]);
  expect(replaced.entries[1].tags).toEqual(['MULTI', 'MERGED']);
  expect(replaced.subtitle_sources[0].path).toBe(subtitle);
  expect(replaced.speakers.slice(-2).map((s: { id: string }) => s.id)).toEqual(original.speakers.map((s: { id: string }) => s.id));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await save(page);
  const restored = await disk();
  for (const key of ['entries', 'speakers', 'subtitle_sources']) expect(restored[key]).toEqual(original[key]);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await save(page);
  const redone = await disk();
  for (const key of ['entries', 'speakers', 'subtitle_sources']) expect(redone[key]).toEqual(replaced[key]);
  await page.reload();
  await openProject(page, original.name);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
  await expect(page.getByLabel('字幕正文')).toHaveValue('甲\n乙');
  expect(await fs.readFile(subtitle, 'utf8')).toBe(rows.map(row => JSON.stringify(row)).join('\n'));
});

test('UI 新建 JSONL 工程并触发四种实际导出，默认干净人物 SRT 与元标签显式开关', async ({ page }) => {
  const subtitle = path.join(inputs, '导出.jsonl');
  await fs.writeFile(subtitle, rows.map(row => JSON.stringify(row)).join('\n'));
  await page.goto('/');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByLabel('视频绝对路径').fill(path.join(inputs, '短片.mp4'));
  await page.getByLabel('导入格式').selectOption('normalized-jsonl');
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(subtitle);
  await page.getByRole('button', { name: '解析预览' }).click();
  const created = page.waitForResponse(r => r.url().endsWith('/projects') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  const original = await (await created).json();
  await expect(page.getByLabel('导出格式')).toHaveValue('speaker-srt');
  const labels = { 'speaker-srt': '说话人 SRT', 'plain-srt': '普通 SRT', 'normalized-jsonl': '项目 JSONL', 'moss-json': 'MOSS JSON' };
  const outputs: Record<string, string> = {};
  for (const [format, label] of Object.entries(labels)) {
    await page.getByLabel('导出格式').selectOption(format);
    const response = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
    await page.getByRole('button', { name: `导出${label}`, exact: true }).click();
    const result = await (await response).json();
    await expect(page.getByRole('link', { name: result.export.filename })).toBeVisible();
    outputs[format] = await fs.readFile(result.export.path, 'utf8');
    const downloaded = await page.request.get(result.url);
    expect(await downloaded.text()).toBe(outputs[format]);
    expect(result.export.format).toBe(format);
  }
  expect(outputs['speaker-srt']).toBe('1\n00:00:01,250 --> 00:00:02,750\n[Iroha&Kaguya] 甲\n乙\n\n2\n00:00:01,250 --> 00:00:02,750\n[?] 同时间\n\n3\n00:00:03,000 --> 00:00:04,000\n[NONSPEECH] 后面的声音\n');
  expect(outputs['plain-srt']).toContain('\n甲\n乙\n');
  expect(outputs['plain-srt']).not.toContain('[Iroha&Kaguya]');
  const jsonl = outputs['normalized-jsonl'].trim().split('\n').map(line => JSON.parse(line));
  expect(jsonl).toEqual([ { ...rows[1], idx: 1 }, { ...rows[2], idx: 2 }, { ...rows[0], idx: 3 } ]);
  const moss = JSON.parse(outputs['moss-json']);
  expect(new Set(moss.map((entry: { id: string }) => entry.id)).size).toBe(3);
  expect(Object.keys(moss[0]).sort()).toEqual(['end', 'id', 'speaker', 'start', 'text']);
  expect(moss[0].speaker).toBe('Iroha&Kaguya');
  await page.getByLabel('导出格式').selectOption('speaker-srt');
  await page.getByLabel('保留已有元标签').check();
  const tagged = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '导出说话人 SRT', exact: true }).click();
  const taggedOutput = await (await tagged).json();
  expect(await fs.readFile(taggedOutput.export.path, 'utf8')).toContain('[Iroha&Kaguya] {MULTI} {MERGED} 甲\n乙');
  const saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries).toEqual(original.entries);
  expect(saved.exports).toHaveLength(5);
});

test('三种 SRT 显式预览、失败和取消不改变工程，MOSS 来源 ID 保留且导出不伪造 ASS 索引', async ({ page }) => {
  const original = await fixture(page);
  const subtitle = path.join(inputs, '模式.srt');
  const source = '9\n00:00:01,000 --> 00:00:03,000\n[笑声] {MULTI} 正文: 原样\n第二行\n';
  await fs.writeFile(subtitle, source);
  await page.getByRole('button', { name: '替换字幕', exact: true }).click();
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(subtitle);
  await page.getByLabel('导入格式').selectOption('plain-srt');
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog').getByText('[笑声] {MULTI} 正文: 原样\n第二行', { exact: true })).toBeVisible();
  await page.getByLabel('导入格式').selectOption('speaker-srt');
  await expect(page.getByRole('button', { name: '应用替换', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog').getByText('正文: 原样\n第二行', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('元标签：MULTI');
  await fs.writeFile(subtitle, '9\n00:00:01,000 --> 00:00:03,000\nS00: 正文: 后续冒号\n下一行\n');
  await page.getByLabel('导入格式').selectOption('moss-srt');
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog')).toContainText('[S00]');
  await expect(page.getByRole('dialog').getByText('正文: 后续冒号\n下一行', { exact: true })).toBeVisible();
  await fs.writeFile(subtitle, '9\n00:00:01,000 --> 00:00:03,000\nS00: 有效\n\n2\n00:00:02,000 --> 00:00:01,000\nS00: 错误');
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('第 2 条 · time');
  await expect(page.getByRole('button', { name: '应用替换', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  expect(await (await page.request.get(`/api/projects/${original.id}`)).json()).toEqual(original);

  const moss = path.join(inputs, '段来源.json');
  await fs.writeFile(moss, JSON.stringify([
    { id: 'seg-72', start: 1.25, end: 3, speaker: 'S00', text: '来自 MOSS\n保留换行' },
    { id: 'seg-72', start: 1.25, end: 3, speaker: 'OTHER', text: '重复来源 ID 仍为独立条目' },
  ]));
  await page.getByRole('button', { name: '替换字幕', exact: true }).click();
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(moss);
  await page.getByLabel('导入格式').selectOption('moss-json');
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog')).toContainText('MOSS ID seg-72');
  // Apply exactly the complete preview, even if the external source subsequently changes.
  await fs.writeFile(moss, '[]');
  await page.getByRole('button', { name: '应用替换', exact: true }).click();
  await page.getByRole('button', { name: '列表字幕 1', exact: true }).click();
  await page.getByLabel('说话人名称').fill('校对后的标签');
  await save(page);
  const saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries.map((entry: { sources: unknown[] }) => entry.sources)).toEqual([
    [{ subtitle_id: saved.subtitle_sources[0].id, index: null, source_entries: [], moss_id: 'seg-72' }],
    [{ subtitle_id: saved.subtitle_sources[0].id, index: null, source_entries: [], moss_id: 'seg-72' }],
  ]);
  for (const [format, label] of [['moss-json', 'MOSS JSON'], ['normalized-jsonl', '项目 JSONL']]) {
    await page.getByLabel('导出格式').selectOption(format);
    const exported = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
    await page.getByRole('button', { name: `导出${label}`, exact: true }).click();
    const result = await (await exported).json();
    const text = await fs.readFile(result.export.path, 'utf8');
    if (format === 'moss-json') {
      const output = JSON.parse(text);
      expect(output[0].speaker).toBe('校对后的标签');
      expect(output[0].id).not.toBe(output[1].id);
      const reimport = await page.request.post('/api/imports/preview', { data: { media_path: original.media.path, subtitle_path: result.export.path, format } });
      expect(reimport.ok()).toBeTruthy();
      expect((await reimport.json()).entries).toHaveLength(2);
    } else {
      expect(text.trim().split('\n').map(line => JSON.parse(line).source_entries)).toEqual([[], []]);
    }
  }
});

test('新建时来源在预览后变化需重新预览，失败不创建工程', async ({ page }) => {
  const subtitle = path.join(inputs, '变化.srt');
  await fs.writeFile(subtitle, '1\n00:00:01,000 --> 00:00:02,000\n预览版本\n');
  await page.goto('/');
  await page.getByRole('button', { name: '新建工程', exact: true }).click();
  await page.getByLabel('视频绝对路径').fill(path.join(inputs, '短片.mp4'));
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(subtitle);
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog')).toContainText('预览版本');
  const before = await (await page.request.get('/api/projects')).json();
  await fs.writeFile(subtitle, '1\n00:00:01,000 --> 00:00:02,000\n外部新版\n');
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('重新解析预览');
  await expect(page.getByRole('button', { name: '创建工程', exact: true })).toBeDisabled();
  expect(await (await page.request.get('/api/projects')).json()).toEqual(before);
  await page.getByRole('button', { name: '解析预览' }).click();
  await expect(page.getByRole('dialog')).toContainText('外部新版');
  await page.getByRole('button', { name: '创建工程', exact: true }).click();
  await expect(page.getByRole('button', { name: '列表字幕 1', exact: true })).toContainText('外部新版');
});
