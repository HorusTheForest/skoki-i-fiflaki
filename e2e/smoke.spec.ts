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
  expect(size).toEqual([320, 180]);
  expect(errors).toEqual([]);
});

test('a freestyle dive played by the bot reaches the results', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./?autoplay');
  await activeScene(page, 'Menu');
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
