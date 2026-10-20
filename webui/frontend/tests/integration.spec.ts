import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/api';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const row = (page: Page, n: number) => button(page, `列表字幕 ${n}`);
const status = (page: Page) => page.getByRole('status', { name: '保存状态' });

test('跨票组合：来源标签→重排双视图批量→筛选结构→故障恢复→独立副本四格式', async ({ page }) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, '最终组合.jsonl');
  const rows = [
    { idx: 91, start: .2, end: 1.5, speaker: '甲', text: '目标一\n第二行', tags: ['MULTI'], source_entries: [9, 9, 2] },
    { idx: 7, start: .5, end: 1.6, speaker: '乙', text: '隐藏的中间条', tags: ['MERGED'], source_entries: [8] },
    { idx: 65, start: 2, end: 3, speaker: '甲', text: '目标三', tags: ['CUSTOM', 'MULTI'], source_entries: [0, 4] },
    { idx: 33, start: 3.2, end: 4, speaker: '乙', text: '后句', tags: [], source_entries: [] },
    { idx: 14, start: 5, end: 6, speaker: '甲&乙', text: '组合标签', tags: [], source_entries: [22] },
    { idx: 15, start: 6.2, end: 7, speaker: 'NONSPEECH', text: '非对白', tags: [], source_entries: [23] },
  ];
  const source = rows.map(e => JSON.stringify(e)).join('\n'); await fs.writeFile(subtitle, source);
  await page.goto('/'); await button(page, '新建工程').click();
  await page.getByLabel('工程名称', { exact: true }).fill(`最终组合-${Date.now()}`);
  await page.getByLabel('视频绝对路径', { exact: true }).fill(path.join(inputs, '短片.mp4'));
  await page.getByLabel('字幕绝对路径', { exact: true }).fill(subtitle);
  await page.getByLabel('导入格式').selectOption('normalized-jsonl');
  await button(page, '解析预览').click();
  await expect(page.getByText(/原来源索引 \[9, 9, 2\]/)).toBeVisible();
  const creation = page.waitForResponse(r => r.url().endsWith('/api/projects') && r.request().method() === 'POST');
  await button(page, '创建工程').click(); const project: Project = await (await creation).json();
  const disk = async (): Promise<Project> => (await page.request.get(`/api/projects/${project.id}`)).json();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  await page.getByLabel('拖动排序 甲', { exact: true }).dragTo(page.getByRole('group', { name: '说话人 乙', exact: true }));
  await expect(status(page)).toHaveText('已保存');
  expect((await disk()).speakers.map(s => s.label)).toEqual(['乙', '甲', '甲&乙', '?', 'NONSPEECH']);
  await page.getByRole('tab', { name: '字幕', exact: true }).click();
  await row(page, 1).click();
  await button(page, '字幕总览：目标一\n第二行').click({ modifiers: ['Control', 'Shift'] });
  await button(page, '甲：目标一\n第二行').click({ modifiers: ['Control', 'Shift'] });
  await expect(row(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.batch-editor')).toHaveCount(0);
  await row(page, 2).click({ modifiers: ['Control'] });
  await expect(page.getByLabel('选择数量')).toHaveText('已选 2 条');
  await page.keyboard.press('ArrowDown'); await expect(status(page)).toHaveText('已保存');
  const shifted = await disk();
  const labels = new Map(shifted.speakers.map(s => [s.id, s.label]));
  expect(shifted.entries.slice(0, 2).map(e => labels.get(e.speaker_id))).toEqual(['甲&乙', '甲']);
  expect(shifted.entries.map(e => [e.id, e.start_ms, e.end_ms, e.sources, e.tags])).toEqual(project.entries.map(e => [e.id, e.start_ms, e.end_ms, e.sources, e.tags]));
  await button(page, '撤销').click();
  await page.getByLabel('批量说话人归属').selectOption('甲&乙'); await button(page, '应用批量归属').click();
  await expect(status(page)).toHaveText('已保存');
  expect((await disk()).entries.slice(0, 2).map(e => labels.get(e.speaker_id))).toEqual(['甲&乙', '甲&乙']);
  await button(page, '撤销').click();
  await page.getByLabel('搜索字幕').fill('目标');
  await row(page, 1).click(); await row(page, 3).click({ modifiers: ['Control'] });
  await expect(button(page, '合并字幕')).toBeDisabled();
  await row(page, 1).click();
  await row(page, 3).click({ modifiers: ['Shift'] });
  await expect(page.getByLabel('选择数量')).toHaveText('已选 3 条');
  await button(page, '合并字幕').click();
  await expect(page.getByLabel('合并结果说话人')).toHaveValue('');
  await page.getByLabel('合并结果说话人').selectOption(project.speakers.find(s => s.label === '甲&乙')!.id);
  await button(page, '确认合并字幕').click(); await expect(status(page)).toHaveText('已保存');
  const merged = await disk();
  expect(merged.entries).toHaveLength(4);
  expect(merged.entries[0]).toEqual({ ...project.entries[0], id: expect.any(String), end_ms: 3000, text: '目标一\n第二行\n隐藏的中间条\n目标三',
    speaker_id: project.speakers.find(s => s.label === '甲&乙')!.id, tags: ['MULTI', 'MERGED', 'CUSTOM'], sources: project.entries.slice(0, 3).flatMap(e => e.sources) });
  await page.getByLabel('跳转时间').fill('00:00:01,000'); await button(page, '跳转').click();
  await button(page, '拆分字幕').click(); await expect(status(page)).toHaveText('已保存');
  const split = await disk();
  expect(split.entries.slice(0, 2).map(e => [e.start_ms, e.end_ms, e.text, e.sources, e.tags])).toEqual([
    [200, 1000, merged.entries[0].text, merged.entries[0].sources, merged.entries[0].tags],
    [1000, 3000, merged.entries[0].text, merged.entries[0].sources, merged.entries[0].tags],
  ]);
  await button(page, '撤销').click(); await expect(status(page)).toHaveText('已保存');
  expect((await disk()).entries).toEqual(merged.entries);
  await button(page, '清除筛选').click(); await row(page, 1).click();
  await page.getByLabel('开始时间', { exact: true }).fill('00:00:04,000');
  await button(page, '导出说话人 SRT').click();
  await expect(page.getByLabel('开始时间', { exact: true })).toBeFocused();
  expect((await disk()).entries).toEqual(merged.entries);
  await page.keyboard.press('Escape');
  const endpoint = `**/api/projects/${project.id}`;
  await page.route(endpoint, route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: { error: { message: '验收外部保存故障' } } }) : route.continue());
  await page.getByLabel('字幕正文').fill('最终组合提交\n保留全部来源');
  await button(page, '保存工程').click(); await expect(status(page)).toHaveText('保存失败');
  expect((await disk()).entries).toEqual(merged.entries);
  await page.unroute(endpoint); await button(page, '重试保存').click(); await expect(status(page)).toHaveText('已保存');
  const recovered = await disk(); expect(recovered.entries[0].sources).toEqual(merged.entries[0].sources);
  await button(page, '文件').click(); await button(page, '工程另存为…').click();
  await page.getByLabel('副本工程名称').fill(`${project.name}-副本`);
  const copyResponse = page.waitForResponse(r => r.url().endsWith('/save-as'));
  await button(page, '创建独立副本').click(); const copy: Project = await (await copyResponse).json();
  expect(copy.id).not.toBe(project.id); expect(copy.entries).toEqual(recovered.entries); expect(copy.speakers).toEqual(recovered.speakers);
  await expect(button(page, '撤销')).toBeDisabled();
  const outputs: Record<string, string> = {};
  for (const [format, label] of Object.entries({ 'speaker-srt': '说话人 SRT', 'plain-srt': '普通 SRT', 'normalized-jsonl': '项目 JSONL', 'moss-json': 'MOSS JSON' })) {
    await page.getByLabel('导出格式').selectOption(format);
    if (format.endsWith('-srt')) await page.getByLabel('保留已有元标签').check();
    const response = page.waitForResponse(r => r.url().endsWith('/exports') && r.request().method() === 'POST');
    await button(page, `导出${label}`).click(); const result = await (await response).json();
    outputs[format] = await fs.readFile(result.export.path, 'utf8');
    expect(await (await page.request.get(result.url)).text()).toBe(outputs[format]);
  }
  expect(outputs['speaker-srt']).toContain('[甲&乙] {MULTI} {MERGED} {CUSTOM} 最终组合提交');
  expect(outputs['plain-srt']).toContain('{MULTI} {MERGED} {CUSTOM} 最终组合提交');
  expect(JSON.parse(outputs['normalized-jsonl'].trim().split('\n')[0])).toEqual({ idx: 1, start: .2, end: 3, speaker: '甲&乙', text: '最终组合提交\n保留全部来源', tags: ['MULTI', 'MERGED', 'CUSTOM'], source_entries: [9, 9, 2, 8, 0, 4] });
  const moss = JSON.parse(outputs['moss-json']); expect(new Set(moss.map((e: { id: string }) => e.id)).size).toBe(4);
  expect(Object.keys(moss[0]).sort()).toEqual(['end', 'id', 'speaker', 'start', 'text']);
  expect((await disk()).entries).toEqual(recovered.entries); expect(await fs.readFile(subtitle, 'utf8')).toBe(source);
  await page.reload(); await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, copy.name).click();
  await row(page, 1).click(); await expect(page.getByLabel('字幕正文')).toHaveValue('最终组合提交\n保留全部来源');
  await page.screenshot({ path: '../tests/evidence/ticket-13-combination.jpg' });
  expect(errors).toEqual([]);
  await fs.writeFile('../tests/evidence/ticket-13-combination.json', JSON.stringify({ original: recovered, copy, outputs }, null, 2));
});
