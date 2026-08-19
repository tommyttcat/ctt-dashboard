import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
export const maxDuration = 45;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const defaultTarget = 'https://app.confluencetradingtools.com/dashboard';
  let target = url.searchParams.get('url') || defaultTarget;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && target.includes('confluencetradingtools.com')) {
    const sep = target.includes('?') ? '&' : '?';
    target = `${target}${sep}_ss=${encodeURIComponent(cronSecret)}`;
  }
  const w = parseInt(url.searchParams.get('w') || '1280');
  const h = parseInt(url.searchParams.get('h') || '900');
  const clip = url.searchParams.get('clip');

  const secret = process.env.CRON_SECRET;
  const force = url.searchParams.get('force') === '1';
  if (!force && secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return new Response('unauthorized', { status: 401 });
    }
  }

  let browser;
  try {
    const execPath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: w, height: h, deviceScaleFactor: 3 },
      executablePath: execPath,
      headless: true,
    });

    const page = await browser.newPage();
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 12000 });
    await page.waitForSelector('[data-loaded]', { timeout: 5000 }).catch(() => {});
    await page.addStyleTag({ content: 'body { filter: brightness(1.25) contrast(1.05); }' });
    await new Promise(r => setTimeout(r, 1000));

    const screenshotOpts: any = { type: 'png' };
    if (clip) {
      const [x, y, cw, ch] = clip.split(',').map(Number);
      screenshotOpts.clip = { x, y, width: cw, height: ch };
    } else {
      screenshotOpts.fullPage = false;
    }

    const buffer = await page.screenshot(screenshotOpts);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e: any) {
    return Response.json(
      { error: e.message || String(e), stack: e.stack?.split('\n').slice(0, 5) },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
