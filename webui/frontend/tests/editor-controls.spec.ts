import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function open(page: Page, name: string) {
  await button(page, '文件').click(); await button(page, '打开工程…').click(); await button(page, name).click();
}
async function fixture(page: Page) {
  const inputs = path.resolve('.test-workspace/inputs');
  const subtitle = path.join(inputs, `控件-${Date.now()}.jsonl`);
  await fs.writeFile(subtitle, [
    { start: 1, end: 2, speaker: '甲', text: '甲一' },
    { start: 2.5, end: 3, speaker: '乙', text: '乙一' },
    { start: 4, end: 5, speaker: '甲', text: '甲二' },
    { start: 5.5, end: 6, speaker: '乙', text: '乙二' },
  ].map((e, i) => JSON.stringify({ ...e, idx: i + 1 })).join('\n'));
  const response = await page.request.post('/api/projects', { data: { name: `控件-${Date.now()}`, media_path: path.join(inputs, '短片.mp4'), subtitle_path: subtitle, format: 'normalized-jsonl' } });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto('/'); await open(page, project.name);
  return project;
}
async function save(page: Page) { await button(page, '保存工程').click(); await expect(page.getByRole('status', { name: '保存状态' })).toHaveText('已保存'); }

test('隐藏人物贯穿显示导航选择与四格式导出，保存副本和恢复不丢字幕', async ({ page }) => {
  const original = await fixture(page);
  const disk = async () => (await page.request.get(`/api/projects/${original.id}`)).json();
  await button(page, '列表字幕 2').click();
  await button(page, '隐藏轨道 乙').click();
  await expect(page.getByLabel('字幕正文', {exact:true})).toHaveCount(0);
  await expect(page.getByLabel('字幕列表', {exact:true})).not.toContainText('乙一');
  await expect(button(page, '乙：乙一')).toHaveCount(0);
  await expect(button(page, '字幕总览：乙一')).toHaveCount(0);
  await button(page, '列表字幕 1').click(); await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('字幕正文', {exact:true})).toHaveValue('甲二');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('字幕正文', {exact:true})).toHaveValue('甲二');
  await page.getByLabel('跳转时间',{exact:true}).fill('00:00:02,600'); await button(page,'跳转').click();
  await expect(page.getByLabel('播放字幕')).not.toContainText('乙一');
  await button(page,'播放').click(); await expect(page.locator('video')).toHaveJSProperty('paused',false); await button(page,'暂停').click();
  await save(page);
  let saved = await disk(); expect(saved.entries).toEqual(original.entries);
  expect(saved.speakers.find((s: {label:string}) => s.label==='乙').visible).toBe(false);
  for (const [format,label] of [['speaker-srt','说话人 SRT'],['plain-srt','普通 SRT'],['normalized-jsonl','项目 JSONL'],['moss-json','MOSS JSON']]) {
    await page.getByLabel('导出格式').selectOption(format);
    const result = page.waitForResponse(r=>r.url().endsWith('/exports') && r.request().method()==='POST');
    await button(page,`导出${label}`).click();
    const exported=await (await result).json();
    const text=await (await page.request.get(exported.url)).text();
    expect(text).toContain('甲一'); expect(text).toContain('甲二'); expect(text).not.toContain('乙一'); expect(text).not.toContain('乙二');
    if (await button(page,'关闭资源菜单').isVisible()) await button(page,'关闭资源菜单').click();
  }
  await page.reload(); await open(page,original.name);
  await expect(button(page,'显示轨道 乙')).toBeVisible();
  await button(page,'文件').click(); await button(page,'工程另存为…').click();
  await page.getByLabel('副本工程名称').fill('可见性副本');
  const copied=page.waitForResponse(r=>r.url().endsWith('/save-as') && r.request().method()==='POST');
  await button(page,'创建独立副本').click(); const copy=await (await copied).json();
  expect(copy.entries).toEqual(original.entries); expect(copy.speakers.find((s:{label:string})=>s.label==='乙').visible).toBe(false);
  await button(page,'显示轨道 乙').click(); await save(page);
  await expect(page.getByLabel('字幕列表',{exact:true})).toContainText('乙一');
  await button(page,'撤销').click(); await expect(button(page,'显示轨道 乙')).toBeVisible();
  await button(page,'重做').click(); await expect(button(page,'隐藏轨道 乙')).toBeVisible();
  saved=await disk(); expect(saved.entries).toEqual(original.entries); expect(saved.speakers.find((s:{label:string})=>s.label==='乙').visible).toBe(false);
});

test('轨道标题长按排序、短按不排序，松开一步提交，Esc取消并可撤销重做', async ({page}) => {
  const original=await fixture(page);
  const labels=page.locator('.track-label');
  const initial=['🔒 视频轨','字幕总览','甲','乙','未标注 ?','非对白 NONSPEECH'];
  await expect(labels).toHaveText(initial);
  const from=button(page,'选择轨道 甲'), to=button(page,'选择轨道 乙');
  await from.click(); await expect(labels).toHaveText(initial);
  const drag=async (cancel=false) => {
    await from.scrollIntoViewIfNeeded(); const a=(await from.boundingBox())!;
    await page.mouse.move(a.x+25,a.y+a.height/2); await page.mouse.down();
    await page.waitForTimeout(420);
    await expect(page.getByRole('status').filter({hasText:'拖动至目标轨道'})).toBeVisible();
    const b=(await to.boundingBox())!;
    await page.mouse.move(b.x+25,b.y+b.height/2,{steps:6});
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await drag(true); await expect(labels).toHaveText(initial); await expect(button(page,'撤销')).toBeDisabled();
  await drag(); await expect(labels).toHaveText(['🔒 视频轨','字幕总览','乙','甲','未标注 ?','非对白 NONSPEECH']);
  await save(page);
  expect((await (await page.request.get(`/api/projects/${original.id}`)).json()).speakers.slice(0,2).map((s:{label:string})=>s.label)).toEqual(['乙','甲']);
  await button(page,'撤销').click(); await expect(labels).toHaveText(initial);
  await button(page,'重做').click(); await expect(labels).toHaveText(['🔒 视频轨','字幕总览','乙','甲','未标注 ?','非对白 NONSPEECH']);
});

test('精简资源卡与图标按钮、自有播放音量控制、SRT时间码校验并保存', async ({page},info) => {
  const project=await fixture(page);
  await expect(page.locator('video')).toHaveJSProperty('controls',false);
  await expect(page.getByRole('region',{name:'工程资源配置'})).toBeHidden();
  await expect(page.getByLabel('工程文件').locator('article')).toHaveCount(2);
  await expect(button(page,'保存工程')).toHaveAttribute('title','保存工程');
  await expect(button(page,'保存工程').locator('svg')).toHaveCount(1);
  await button(page,'工程资源菜单').click(); await expect(page.getByLabel('预览质量')).toBeVisible();
  await expect(button(page,'生成音频波形')).toBeVisible();
  await button(page,'关闭资源菜单').click();
  await page.getByLabel('音量',{exact:true}).fill('0.35'); await expect(page.locator('video')).toHaveJSProperty('volume',.35);
  await button(page,'静音').click(); await expect(page.locator('video')).toHaveJSProperty('muted',true);
  await button(page,'取消静音').click(); await expect(page.locator('video')).toHaveJSProperty('muted',false);
  await button(page, '全屏').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('video-stage');
  await button(page, '全屏播放暂停').click(); await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await button(page, '全屏播放暂停').click();
  await button(page, '退出全屏').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  await button(page,'列表字幕 1').click(); await expect(page.getByLabel('开始时间',{exact:true})).toHaveValue('00:00:01,000');
  await page.getByLabel('开始时间',{exact:true}).fill('00:00:01,125'); await button(page,'应用修改').click(); await save(page);
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).entries[0].start_ms).toBe(1125);
  await page.getByLabel('结束时间',{exact:true}).fill('00:00:60,000'); await button(page,'保存工程').click();
  await expect(page.getByLabel('结束时间',{exact:true})).toHaveAttribute('aria-invalid','true');
  await page.keyboard.press('Escape'); await expect(page.getByLabel('结束时间',{exact:true})).toHaveValue('00:00:02,000');
  await page.screenshot({path:info.outputPath('editor-controls.jpg')});
});

test('隐藏取消目标试听，全隐藏可保存和空导出，恢复后结构编辑只改可见选择', async ({page}) => {
  const original=await fixture(page);
  await button(page,'列表字幕 1').click(); await button(page,'循环当前字幕').click();
  await button(page,'隐藏轨道 甲').click(); await expect(page.locator('video')).toHaveJSProperty('paused',true);
  await expect(button(page,'退出试听')).toBeDisabled();
  for (const label of ['乙','未标注 ?','非对白 NONSPEECH']) await button(page,`隐藏轨道 ${label}`).click();
  await expect(page.locator('.clip')).toHaveCount(0); await expect(button(page,'新增字幕')).toBeDisabled();
  await save(page); const exported=page.waitForResponse(r=>r.url().endsWith('/exports') && r.request().method()==='POST');
  await button(page,'导出说话人 SRT').click(); const result=await (await exported).json();
  expect(await (await page.request.get(result.url)).text()).toBe('');
  await button(page,'关闭资源菜单').click(); await button(page,'显示轨道 甲').click();
  await button(page,'列表字幕 1').click(); await button(page,'列表字幕 2').click({modifiers:['Shift']});
  await button(page,'合并字幕').click(); await save(page);
  const merged=await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(merged.entries).toHaveLength(3);
  expect(merged.entries.filter((e:{speaker_id:string})=>e.speaker_id===original.speakers[1].id)).toEqual(original.entries.filter((e:{speaker_id:string})=>e.speaker_id===original.speakers[1].id));
});

test('隐藏更新已有多选的合并条件，人物管理不能修改隐藏字幕或转入隐藏轨', async ({page}) => {
  const original = await fixture(page);
  await button(page, '列表字幕 1').click();
  await button(page, '列表字幕 3').click({ modifiers: ['Control'] });
  await expect(button(page, '合并字幕')).toBeDisabled();
  await button(page, '隐藏轨道 乙').click();
  await expect(button(page, '合并字幕')).toBeEnabled();
  await page.getByRole('tab', { name: '说话人', exact: true }).click();
  const hidden = page.getByRole('group', { name: '说话人 乙', exact: true });
  await expect(hidden.getByRole('button', { name: '合并说话人', exact: true })).toBeDisabled();
  await expect(hidden.getByRole('button', { name: '删除人物', exact: true })).toBeDisabled();
  const shown = page.getByRole('group', { name: '说话人 甲', exact: true });
  await shown.getByRole('button', { name: '合并说话人', exact: true }).click();
  await expect(page.getByLabel('合并目标').locator('option')).toHaveCount(1);
  await button(page, '取消合并').click();
  await button(page, '隐藏轨道 未标注 ?').click();
  await expect(shown.getByRole('button', { name: '删除人物', exact: true })).toBeDisabled();
  await save(page);
  const saved = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(saved.entries).toEqual(original.entries);
  await button(page, '显示轨道 乙').click();
  await expect(button(page, '合并字幕')).toBeDisabled();
});

test('长按跨视窗滚动不丢手势，按住期间不保存，释放后完整保存轨序', async ({page}) => {
  const original = await fixture(page);
  const speakers = [
    ...Array.from({ length: 28 }, (_, i) => ({ ...original.speakers[0], id: `longpress-${i}`, label: `人物 ${i}`, order: i })),
    ...original.speakers.slice(-2).map((s: object, i: number) => ({ ...s, order: 28 + i })),
  ];
  const response = await page.request.put(`/api/projects/${original.id}`, { data: {
    revision: original.revision, name: original.name, speakers,
    entries: original.entries.map((e: object, i: number) => ({ ...e, speaker_id: speakers[i].id })),
  } });
  expect(response.ok()).toBeTruthy();
  await page.reload(); await open(page, original.name);
  const source = button(page, '选择轨道 人物 0'), target = button(page, '选择轨道 人物 23');
  const a = (await source.boundingBox())!, viewport = page.getByRole('region', { name: '时间轴轨道滚动区' });
  await page.mouse.move(a.x + 25, a.y + a.height / 2); await page.mouse.down();
  await page.waitForTimeout(420);
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(a.x + 25, box.y + box.height - 20, { steps: 5 });
  await expect.poll(async () => {
    const b = (await target.boundingBox())!;
    return b.y + b.height < box.y + box.height - 32;
  }).toBe(true);
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + 25, b.y + b.height / 2);
  const beforeRelease = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(beforeRelease.speakers).toEqual(speakers);
  await page.mouse.up(); await save(page);
  const after = await (await page.request.get(`/api/projects/${original.id}`)).json();
  expect(after.speakers.slice(0, 24).map((s: { label: string }) => s.label)).toEqual([
    ...Array.from({ length: 23 }, (_, i) => `人物 ${i + 1}`), '人物 0',
  ]);
  expect(after.entries).toEqual(beforeRelease.entries);
});
