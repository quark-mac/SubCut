import { chromium, expect, test, type Browser } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

async function port() {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return value;
}

test('Windows start.cmd 真正启动服务并自动打开独立 Edge 窗口，失败可理解', async ({ request }) => {
  test.skip(process.platform !== 'win32', 'Windows delivery entry');
  test.setTimeout(60000);
  const checkout = path.resolve('../..');
  const root = path.resolve('.test-workspace/launcher'); await fs.mkdir(root, { recursive: true });
  const servicePort = await port(), debuggingPort = await port();
  const edge = path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe');
  await fs.access(edge);
  const python = process.env.WEBUI_PYTHON || 'python';
  const command = path.join(checkout, 'webui/start.cmd');
  let logs = '';
  // webbrowser's documented BROWSER variable opens a real installed Edge with an
  // isolated profile. DevTools observes the tab the launcher opens (no page.goto).
  const child = spawn('cmd.exe', ['/d', '/c', command, '-Python', python, '-Port', String(servicePort), '-Workspace', path.join(root, '工程 workspace')], {
    cwd: root, env: { ...process.env, BROWSER: `"${edge}" --user-data-dir="${path.join(root, `edge-${Date.now()}`)}" --remote-debugging-port=${debuggingPort} --no-first-run --no-default-browser-check %s` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { logs += chunk.toString(); }); child.stderr.on('data', chunk => { logs += chunk.toString(); });
  let observed: Browser | null = null;
  let observation: Record<string, unknown> = {};
  try {
    await expect.poll(async () => { try { return (await request.get(`http://127.0.0.1:${servicePort}/api/health`)).status(); } catch { return 0; } }, { timeout: 20000 }).toBe(200);
    await expect.poll(async () => { try { return (await request.get(`http://127.0.0.1:${debuggingPort}/json/version`)).status(); } catch { return 0; } }, { timeout: 20000 }).toBe(200);
    observed = await chromium.connectOverCDP(`http://127.0.0.1:${debuggingPort}`);
    const browser = observed;
    await expect.poll(() => browser.contexts().flatMap(c => c.pages()).some(p => p.url() === `http://127.0.0.1:${servicePort}/`)).toBe(true);
    const opened = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === `http://127.0.0.1:${servicePort}/`)!;
    await expect(opened.getByRole('button', { name: '新建工程', exact: true })).toBeVisible();
    await opened.screenshot({ path: '../tests/evidence/ticket-13-windows-launch.jpg' });
    const missing = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(checkout, 'webui/start.ps1'), '-Python', path.join(root, 'missing-python.exe')], { cwd: root });
    let failure = ''; missing.stdout.on('data', b => { failure += b.toString(); }); missing.stderr.on('data', b => { failure += b.toString(); });
    const code = await new Promise<number | null>(resolve => missing.on('exit', resolve));
    expect(code).not.toBe(0); expect(failure).toContain('Existing Python not found'); expect(failure).toContain('WEBUI_PYTHON');
    observation = { browser: browser.version(), command, cwd: root, servicePort, debuggingPort, url: opened.url(), failureExitCode: code, failure };
  } finally {
    if (observed) {
      const cdp = await observed.newBrowserCDPSession(); await cdp.send('Browser.close').catch(() => {});
      await observed.close();
    }
    // The shell tree can be exiting while taskkill enumerates it. Kill only our
    // logged Python PID first, then best-effort shell cleanup; verify the public
    // ports really closed instead of treating a taskkill enumeration race as success.
    const serverPid = /Started server process \[(\d+)\]/.exec(logs)?.[1];
    if (serverPid) {
      try { process.kill(Number(serverPid)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    const cleanup = child.pid && child.exitCode === null ? spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { encoding: 'utf8' }) : null;
    for (const closedPort of [servicePort, debuggingPort]) {
      await expect.poll(async () => {
        try { await request.get(`http://127.0.0.1:${closedPort}/${closedPort === servicePort ? 'api/health' : 'json/version'}`, { timeout: 500 }); return false; }
        catch { return true; }
      }, { timeout: 10000 }).toBe(true);
    }
    await fs.writeFile('../tests/evidence/ticket-13-launcher.json', JSON.stringify({ ...observation, serverPid, portsClosed: true, cleanup: cleanup && { status: cleanup.status, stdout: cleanup.stdout, stderr: cleanup.stderr }, logs }, null, 2));
  }
});
