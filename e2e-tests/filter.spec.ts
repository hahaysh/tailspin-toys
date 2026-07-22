import { test, expect } from '@playwright/test';

test.describe('Game Filtering', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('filter-bar')).toBeVisible();
        await expect(page.getByTestId('games-grid')).toBeVisible();
    });

    test('filter bar renders category checkboxes and publisher select', async ({ page }) => {
        await test.step('Verify filter bar is present', async () => {
            const filterBar = page.getByTestId('filter-bar');
            await expect(filterBar).toBeVisible();
        });

        await test.step('Verify category checkboxes are present', async () => {
            const categoryList = page.getByTestId('filter-category-list');
            const checkboxes = categoryList.getByRole('checkbox');
            await expect(checkboxes).toHaveCount(5); // Strategy, Puzzle, Simulation, Adventure, Action
        });

        await test.step('Verify publisher select is present', async () => {
            const publisherSelect = page.getByTestId('filter-publisher');
            await expect(publisherSelect).toBeVisible();
            // "All Publishers" default + 4 publishers
            await expect(publisherSelect.locator('option')).toHaveCount(5);
        });

        await test.step('Verify clear filters button is present', async () => {
            await expect(page.getByTestId('filter-clear')).toBeVisible();
        });
    });

    test('filter by a single category shows only matching games', async ({ page }) => {
        const totalBefore = await page.locator('[data-testid="game-card"]:visible').count();

        await test.step('Select the Strategy category', async () => {
            await page.getByLabel('Filter by category: Strategy').check();
        });

        await test.step('Verify only Strategy games are visible', async () => {
            const visibleCards = page.locator('[data-testid="game-card"]:visible');
            // Strategy has 4 games
            await expect(visibleCards).toHaveCount(4);
            expect(await visibleCards.count()).toBeLessThan(totalBefore);
        });

        await test.step('Verify the games grid is visible', async () => {
            await expect(page.getByTestId('games-grid')).toBeVisible();
        });

        await test.step('Verify no-results message is hidden', async () => {
            await expect(page.getByTestId('filter-no-results')).toBeHidden();
        });
    });

    test('filter by publisher shows only games from that publisher', async ({ page }) => {
        const totalBefore = await page.locator('[data-testid="game-card"]:visible').count();

        await test.step('Select "GitHub Games" from publisher dropdown', async () => {
            await page.getByTestId('filter-publisher').selectOption({ label: 'GitHub Games' });
        });

        await test.step('Verify only GitHub Games titles are visible', async () => {
            const visibleCards = page.locator('[data-testid="game-card"]:visible');
            // GitHub Games has 5 games
            await expect(visibleCards).toHaveCount(5);
            expect(await visibleCards.count()).toBeLessThan(totalBefore);
        });
    });

    test('combining category and publisher filters narrows results', async ({ page }) => {
        await test.step('Select the Strategy category', async () => {
            await page.getByLabel('Filter by category: Strategy').check();
        });

        await test.step('Select "CodeForge Studios" from publisher dropdown', async () => {
            await page.getByTestId('filter-publisher').selectOption({ label: 'CodeForge Studios' });
        });

        await test.step('Verify only the one Strategy game by CodeForge Studios is shown', async () => {
            const visibleCards = page.locator('[data-testid="game-card"]:visible');
            // Only "DevOps Dominion" matches Strategy + CodeForge Studios
            await expect(visibleCards).toHaveCount(1);
            await expect(visibleCards.first().getByTestId('game-title')).toHaveText('DevOps Dominion');
        });
    });

    test('selecting multiple categories shows games from all selected categories', async ({ page }) => {
        await test.step('Select Strategy and Puzzle categories', async () => {
            await page.getByLabel('Filter by category: Strategy').check();
            await page.getByLabel('Filter by category: Puzzle').check();
        });

        await test.step('Verify games from both categories are visible', async () => {
            const visibleCards = page.locator('[data-testid="game-card"]:visible');
            // Strategy (4) + Puzzle (4) = 8 games
            await expect(visibleCards).toHaveCount(8);
        });
    });

    test('clearing filters restores all games', async ({ page }) => {
        const totalGames = await page.locator('[data-testid="game-card"]:visible').count();

        await test.step('Apply category and publisher filters', async () => {
            await page.getByLabel('Filter by category: Action').check();
            await page.getByTestId('filter-publisher').selectOption({ label: 'Ops Interactive' });
            // Verify filtered state has fewer results
            const filteredCount = await page.locator('[data-testid="game-card"]:visible').count();
            expect(filteredCount).toBeLessThan(totalGames);
        });

        await test.step('Click Clear filters', async () => {
            await page.getByTestId('filter-clear').click();
        });

        await test.step('Verify all games are visible again', async () => {
            const visibleCards = page.locator('[data-testid="game-card"]:visible');
            await expect(visibleCards).toHaveCount(totalGames);
        });

        await test.step('Verify category checkboxes are unchecked', async () => {
            const checkedBoxes = page
                .getByTestId('filter-category-list')
                .getByRole('checkbox', { checked: true });
            await expect(checkedBoxes).toHaveCount(0);
        });

        await test.step('Verify publisher select is reset to "All Publishers"', async () => {
            await expect(page.getByTestId('filter-publisher')).toHaveValue('');
        });
    });

    test('no-results message is hidden when all games match', async ({ page }) => {
        // Initially no filters are active — the no-results element should be hidden
        await expect(page.getByTestId('filter-no-results')).toBeHidden();
    });

    test('filter controls are keyboard accessible', async ({ page }) => {
        await test.step('Focus a category checkbox via keyboard and toggle it', async () => {
            const strategyCheckbox = page.getByLabel('Filter by category: Strategy');
            await strategyCheckbox.focus();
            await expect(strategyCheckbox).toBeFocused();
            await page.keyboard.press('Space');
            await expect(strategyCheckbox).toBeChecked();
        });

        await test.step('Verify filtering applied after keyboard interaction', async () => {
            const visibleCards = page.locator('[data-testid="game-card"]:visible');
            await expect(visibleCards).toHaveCount(4);
        });

        await test.step('Focus Clear button and activate with Enter', async () => {
            const clearButton = page.getByTestId('filter-clear');
            await clearButton.focus();
            await expect(clearButton).toBeFocused();
            await page.keyboard.press('Enter');
        });

        await test.step('Verify all games restored after keyboard clear', async () => {
            const strategyCheckbox = page.getByLabel('Filter by category: Strategy');
            await expect(strategyCheckbox).not.toBeChecked();
        });
    });
});
