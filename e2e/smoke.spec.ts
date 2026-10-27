import { expect, test, type Page } from '@playwright/test';

type GameWindow = Window & {
  __game?: {
    scene: {
      isActive(key: string): boolean;
      getScene(key: string): unknown;
    };
  };
};

async function activeScene(page: Page, key: string, timeout = 20_000) {
  await page.waitForFunction((k) => (window as GameWindow).__game?.scene.isActive(k) ?? false, key, { timeout });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('boots into the menu without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await activeScene(page, 'Menu');
  await expect(page.locator('canvas')).toHaveCount(1);
  const size = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  // 960x540 at DPR 1: one device pixel per game pixel
  expect(size).toEqual([960, 540]);
  expect(errors).toEqual([]);
});

test('the buffer follows the window size in whole device pixels', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await activeScene(page, 'Menu');
  await page.setViewportSize({ width: 1920, height: 1080 });
  // 3 device pixels per game pixel: 640x360
  await page.waitForFunction(() => document.querySelector('canvas')?.width === 640, undefined, { timeout: 5_000 });
  await page.setViewportSize({ width: 1366, height: 768 });
  // 2 per pixel: 683x384
  await page.waitForFunction(() => document.querySelector('canvas')?.width === 683, undefined, { timeout: 5_000 });
  await activeScene(page, 'Menu');
  expect(errors).toEqual([]);
});

test('a freestyle dive played by the bot reaches the results', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?autoplay');
  await activeScene(page, 'Menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await activeScene(page, 'Dive');
  await activeScene(page, 'Results', 30_000);
  const total = await page.evaluate(() => {
    const r = (window as GameWindow).__game!.scene.getScene('Results') as unknown as { res: { solo?: { score: { total: number } } } };
    return r.res.solo?.score.total ?? -1;
  });
  expect(total).toBeGreaterThan(30);
  expect(errors).toEqual([]);
});

test('synchro dive with the AI partner reaches the 11-judge results', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?autoplay');
  await activeScene(page, 'Menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await activeScene(page, 'Dive');
  await activeScene(page, 'Results', 30_000);
  const n = await page.evaluate(() => {
    const r = (window as GameWindow).__game!.scene.getScene('Results') as unknown as {
      res: { synchro?: { score: { execA: unknown[]; execB: unknown[]; sync: unknown[] } } };
    };
    const s = r.res.synchro!.score;
    return s.execA.length + s.execB.length + s.sync.length;
  });
  expect(n).toBe(11);
  expect(errors).toEqual([]);
});

test('campaign level 1 is passed, saved and unlocks level 2', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?autoplay');
  await page.evaluate(() => localStorage.clear());
  await activeScene(page, 'Menu');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await activeScene(page, 'Levels');
  await page.keyboard.press('Space');
  await activeScene(page, 'Dive');
  await activeScene(page, 'Results', 30_000);
  const outcome = await page.evaluate(() => {
    const r = (window as GameWindow).__game!.scene.getScene('Results') as unknown as { res: { outcome?: { passed: boolean; stars: number } | null } };
    return r.res.outcome;
  });
  expect(outcome?.passed).toBe(true);
  expect(outcome?.stars).toBeGreaterThan(0);
  const saved = await page.evaluate(() => Object.values(localStorage).join(''));
  expect(saved).toContain('"1":{"stars"');
  // "POZIOM 2" is the first entry of the results menu
  await page.keyboard.press('Space');
  await activeScene(page, 'Dive');
  const id = await page.evaluate(() => ((window as GameWindow).__game!.scene.getScene('Dive') as unknown as { cfg: { levelId: number } }).cfg.levelId);
  expect(id).toBe(2);
  expect(errors).toEqual([]);
});

test('the Odbicie prototype starts and bounces', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await activeScene(page, 'Menu');
  await page.keyboard.press('Space');
  await activeScene(page, 'Bounce');
  await page.keyboard.press('Space');
  type Sim = { sim: { events: { type: string }[] } };
  await page.waitForFunction(
    () => ((window as GameWindow).__game!.scene.getScene('Bounce') as unknown as Sim).sim.events.some((e) => e.type === 'launch'),
    undefined,
    { timeout: 10_000 },
  );
  expect(errors).toEqual([]);
});
