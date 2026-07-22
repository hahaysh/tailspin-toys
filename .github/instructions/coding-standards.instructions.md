---
description: 'Code comment philosophy, TSDoc/JSDoc standards, and TypeScript formatting rules'
applyTo: '**/*.{ts,astro}'
---

# Coding Standards

## Comment Philosophy

**Comment the *why*, not the *what*.** Code explains itself; comments should explain *intent*, *reasoning behind non-obvious decisions*, or *constraints* that the code cannot express on its own.

### Do comment

- The reason a non-obvious algorithm or approach was chosen
- Constraints or invariants that must remain true (e.g., "must stay deterministic for reproducible static builds")
- The *purpose* of a module or exported symbol when it is not self-evident from the name

```ts
// 21 buckets -> 3.0, 3.1, ... 5.0
const tenths = hash % 21;
```

```ts
// Handle CRLF by skipping the paired \n.
if (char === '\r' && content[i + 1] === '\n') {
    i++;
}
```

### Do not comment

- Anything that simply restates the line below it
- Obvious mechanics that any reader of the language would understand immediately

```ts
// BAD — restates the code
// Increment i by one
i++;

// BAD — adds no information over the function name
// Returns the game by id
export async function getGameById(...) { ... }
```

### Outdated comments are bugs

Treat a comment that no longer matches its code as a bug. Update or delete it in the same change that touches the related code.

---

## TSDoc / JSDoc for Exported Functions

Every **exported** function in `db/` and `src/lib/` **must** have a TSDoc block comment that describes:

1. **Purpose** — what the function does and why it exists (first line or paragraph)
2. **`@param`** — for each parameter: its name and what it represents
3. **`@returns`** — what the function returns, including the `null` / empty case where relevant

### Format

```ts
/**
 * Retrieves all games ordered alphabetically by title.
 *
 * Ordering is stable so static builds produce deterministic output.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @returns Array of fully-typed Game objects; empty array when no games exist
 */
export async function getAllGames(db: Database): Promise<Game[]> { ... }
```

```ts
/**
 * Returns a single game by its numeric id, or null when not found.
 *
 * @param db - Drizzle database client (injectable for testing)
 * @param id - Primary key of the game to retrieve
 * @returns The matching Game, or null if no row with that id exists
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> { ... }
```

### Injectable `db` parameter

Data-access helpers take `db` as their first argument so they work with both the real client and an in-memory test client. Always document this intent explicitly in the `@param db` line.

### Non-exported helpers

Private/internal functions do not need full TSDoc, but a brief inline comment is welcome when the logic is non-obvious.

---

## Astro Component `Props` Interfaces

Every reusable `.astro` component **must** document its `Props` interface so the contract is self-explanatory to any reader.

- Add a JSDoc comment on the `Props` interface itself explaining what the component renders
- Add an inline JSDoc comment (`/** ... */`) on each prop that is not self-evident from its name and type

```astro
---
/**
 * Renders a game summary card linking to the game detail page.
 * Displays the title, category/publisher tags, and a truncated description.
 */
interface Props {
  /** The game to display. Must include category and publisher relations. */
  game: Game;
}
---
```

```astro
---
/**
 * Reusable button that renders either a `<button>` or an `<a>` element
 * depending on whether an `href` is supplied.
 */
interface Props extends Omit<HTMLAttributes<'button'>, 'type'> {
  /** Visual style of the button. Defaults to 'solid'. */
  variant?: 'solid' | 'gradient';
  /** Padding scale. Defaults to 'md'. */
  size?: 'sm' | 'md';
  /** When provided, renders an anchor (`<a>`) instead of a `<button>`. */
  href?: string;
}
---
```

---

## TypeScript Formatting Rules

These rules are documented here and enforced by ESLint where possible.

### Explicit types on exported function boundaries (enforced)

All exported functions and their parameters must carry explicit TypeScript types. This rule is enforced via `@typescript-eslint/explicit-module-boundary-types` in `eslint.config.js`.

```ts
// GOOD
export function parseGamesCsv(content: string): GameCsvRow[] { ... }

// BAD — return type is inferred, not explicit
export function parseGamesCsv(content: string) { ... }
```

### `import type` for type-only imports (documented)

Prefer `import type` when importing a symbol used only as a type. This keeps the runtime import graph clean and makes intent explicit.

```ts
import type { Database } from './db';
import type { Game } from '../types/game';
```

### No `any` (enforced by `tseslint.configs.recommended`)

Avoid `any`. Use `unknown` when the type is genuinely unknown, and narrow it with type guards before use.

### Explicit `null` checks over `!` non-null assertions

Prefer conditional checks or optional chaining over the non-null assertion operator (`!`) unless a null value is provably impossible at that point.
