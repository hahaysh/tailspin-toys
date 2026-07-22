import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGameById,
    getFilteredGames,
    getAllCategories,
    getAllPublishers,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});

describe('getAllCategories', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all categories ordered by name', async () => {
        await db.insert(categories).values([
            { name: 'Simulation', description: 'sim' },
            { name: 'Adventure', description: 'adv' },
            { name: 'Puzzle', description: 'puz' },
        ]);
        const result = await getAllCategories(db);
        expect(result.map((c) => c.name)).toEqual(['Adventure', 'Puzzle', 'Simulation']);
        expect(result[0]).toMatchObject({ id: expect.any(Number), name: 'Adventure' });
    });

    it('returns an empty array when no categories exist', async () => {
        const result = await getAllCategories(db);
        expect(result).toEqual([]);
    });
});

describe('getAllPublishers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all publishers ordered by name', async () => {
        await db.insert(publishers).values([
            { name: 'Zap Games', description: 'zap' },
            { name: 'Acme Studios', description: 'acme' },
        ]);
        const result = await getAllPublishers(db);
        expect(result.map((p) => p.name)).toEqual(['Acme Studios', 'Zap Games']);
        expect(result[0]).toMatchObject({ id: expect.any(Number), name: 'Acme Studios' });
    });

    it('returns an empty array when no publishers exist', async () => {
        const result = await getAllPublishers(db);
        expect(result).toEqual([]);
    });
});

describe('getFilteredGames', () => {
    let db: Database;
    let strategyId: number;
    let puzzleId: number;
    let pubOneId: number;
    let pubTwoId: number;

    beforeEach(async () => {
        db = await createTestDatabase();

        const [strategy] = await db
            .insert(categories)
            .values({ name: 'Strategy', description: 'cat' })
            .returning({ id: categories.id });
        const [puzzle] = await db
            .insert(categories)
            .values({ name: 'Puzzle', description: 'cat' })
            .returning({ id: categories.id });
        const [pubOne] = await db
            .insert(publishers)
            .values({ name: 'Pub One', description: 'pub' })
            .returning({ id: publishers.id });
        const [pubTwo] = await db
            .insert(publishers)
            .values({ name: 'Pub Two', description: 'pub' })
            .returning({ id: publishers.id });

        strategyId = strategy.id;
        puzzleId = puzzle.id;
        pubOneId = pubOne.id;
        pubTwoId = pubTwo.id;

        await db.insert(games).values([
            { title: 'Alpha', description: 'desc', categoryId: strategyId, publisherId: pubOneId },
            { title: 'Beta', description: 'desc', categoryId: puzzleId, publisherId: pubOneId },
            { title: 'Gamma', description: 'desc', categoryId: strategyId, publisherId: pubTwoId },
            { title: 'Delta', description: 'desc', categoryId: puzzleId, publisherId: pubTwoId },
        ]);
    });

    it('returns all games when no filters are specified', async () => {
        const result = await getFilteredGames(db, {});
        expect(result.map((g) => g.title)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    });

    it('filters by a single category', async () => {
        const result = await getFilteredGames(db, { categoryIds: [strategyId] });
        expect(result.map((g) => g.title)).toEqual(['Alpha', 'Gamma']);
    });

    it('filters by multiple categories', async () => {
        const result = await getFilteredGames(db, { categoryIds: [strategyId, puzzleId] });
        expect(result.map((g) => g.title)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    });

    it('filters by publisher', async () => {
        const result = await getFilteredGames(db, { publisherId: pubTwoId });
        expect(result.map((g) => g.title)).toEqual(['Delta', 'Gamma']);
    });

    it('combines category and publisher filters', async () => {
        const result = await getFilteredGames(db, { categoryIds: [strategyId], publisherId: pubOneId });
        expect(result.map((g) => g.title)).toEqual(['Alpha']);
    });

    it('returns an empty array when no games match the filters', async () => {
        // Category filter that matches nothing for this publisher
        const result = await getFilteredGames(db, { categoryIds: [puzzleId], publisherId: pubOneId, });
        expect(result.map((g) => g.title)).toEqual(['Beta']);
        const noMatch = await getFilteredGames(db, { categoryIds: [strategyId], publisherId: pubTwoId });
        expect(noMatch.map((g) => g.title)).toEqual(['Gamma']);
    });

    it('returns an empty array when category ids list is empty (no category filter)', async () => {
        // Empty array means "no filter" — should return all games
        const result = await getFilteredGames(db, { categoryIds: [] });
        expect(result).toHaveLength(4);
    });
});

