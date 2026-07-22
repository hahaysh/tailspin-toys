import { eq, asc, and, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game, Category, Publisher } from '../types/game';

/** Filtering options for `getFilteredGames`. */
export interface GameFilters {
    /** Restrict results to games in any of these category ids. Empty array = no category filter. */
    categoryIds?: number[];
    /** Restrict results to games from this publisher id. Omit or pass undefined = no publisher filter. */
    publisherId?: number;
}

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

/**
 * Retrieves all games ordered alphabetically by title.
 *
 * Ordering is stable so static builds produce deterministic output.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @returns Array of fully-typed Game objects; empty array when no games exist
 */
export async function getAllGames(db: Database): Promise<Game[]> {
    const rows = await baseGamesQuery(db).orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Retrieves all game ids ordered alphabetically by title.
 *
 * Used by `getStaticPaths` to enumerate pages at build time without loading
 * full game objects.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @returns Array of numeric game ids in title-alphabetical order
 */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * Returns a single game by its numeric id, or null when not found.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @param id - Primary key of the game to retrieve
 * @returns The matching Game with its category and publisher, or null if no row with that id exists
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const rows = await baseGamesQuery(db).where(eq(games.id, id)).limit(1);
    return rows.length > 0 ? mapGame(rows[0]) : null;
}

/**
 * Retrieves all games matching the supplied filters, ordered alphabetically by title.
 *
 * Passing an empty `GameFilters` object (or omitting optional fields) returns all games,
 * making this a superset of `getAllGames`.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @param filters - Optional category and publisher constraints
 * @returns Array of Games that satisfy every supplied filter; empty array when no games match
 */
export async function getFilteredGames(db: Database, filters: GameFilters): Promise<Game[]> {
    const conditions = [];

    if (filters.categoryIds && filters.categoryIds.length > 0) {
        conditions.push(inArray(games.categoryId, filters.categoryIds));
    }

    if (filters.publisherId !== undefined) {
        conditions.push(eq(games.publisherId, filters.publisherId));
    }

    const query = baseGamesQuery(db).orderBy(asc(games.title));
    const rows = await (conditions.length > 0 ? query.where(and(...conditions)) : query);
    return rows.map(mapGame);
}

/**
 * Retrieves all categories ordered alphabetically by name.
 *
 * Used to populate category filter controls at build time.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @returns Array of Category objects; empty array when no categories exist
 */
export async function getAllCategories(db: Database): Promise<Category[]> {
    const rows = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
    return rows.map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Retrieves all publishers ordered alphabetically by name.
 *
 * Used to populate publisher filter controls at build time.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @returns Array of Publisher objects; empty array when no publishers exist
 */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    const rows = await db.select({ id: publishers.id, name: publishers.name }).from(publishers).orderBy(asc(publishers.name));
    return rows.map((row) => ({ id: row.id, name: row.name }));
}
