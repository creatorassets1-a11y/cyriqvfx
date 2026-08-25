import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, limiters, validate, validatedQuery } from '../middleware/index.js';
import { resourceCardSelect, toResourceCard, mediaUrl } from '../modules/dto.js';
import { publicCache } from '../middleware/cache.js';
import { logger } from '../lib/logger.js';

export const searchRouter = Router();

/**
 * Search (PRD §28, §75). PostgreSQL full-text with weighted fields, falling
 * back to trigram similarity so typos still find things. No search cluster
 * until the catalogue actually demands one.
 */

const searchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(30).default(12),
  /** Suggestion mode powers the header dropdown; it never logs analytics. */
  suggest: z.enum(['true', 'false']).default('false'),
});

/** Builds a prefix-matching tsquery: "beat mark" → 'beat:* & mark:*'. */
function toTsQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  return terms.map((t) => `${t}:*`).join(' & ');
}

interface RankedRow {
  id: string;
  rank: number;
}

searchRouter.get(
  '/',
  limiters.search,
  validate(searchQuery, 'query'),
  publicCache(60),
  asyncHandler(async (req, res) => {
    const { q, limit, suggest } = validatedQuery<z.infer<typeof searchQuery>>(req);
    const tsquery = toTsQuery(q);

    // Full-text relevance first, with trigram word similarity as a fallback so
    // a misspelled query ("halatoin") still finds the right pack. Plain
    // similarity() compares whole strings and scores badly against multi-word
    // titles, so word_similarity() is what actually tolerates typos here.
    const FUZZY_THRESHOLD = 0.45;
    const [resourceRows, tutorialRows] = await Promise.all([
      tsquery
        ? prisma.$queryRaw<RankedRow[]>`
            SELECT r.id,
                   GREATEST(
                     ts_rank(r."searchVector", to_tsquery('english', ${tsquery})),
                     word_similarity(${q}, r."title") * 0.6,
                     COALESCE(MAX(word_similarity(${q}, t."name")), 0) * 0.4
                   ) AS rank
            FROM "Resource" r
            LEFT JOIN "ResourceTag" rt ON rt."resourceId" = r.id
            LEFT JOIN "Tag" t ON t.id = rt."tagId"
            WHERE r.status = 'PUBLISHED'
            GROUP BY r.id
            HAVING r."searchVector" @@ to_tsquery('english', ${tsquery})
               OR word_similarity(${q}, r."title") > ${FUZZY_THRESHOLD}
               OR COALESCE(MAX(word_similarity(${q}, t."name")), 0) > ${FUZZY_THRESHOLD}
            ORDER BY rank DESC, r."downloadCount" DESC
            LIMIT ${limit}
          `
        : Promise.resolve([] as RankedRow[]),
      tsquery
        ? prisma.$queryRaw<RankedRow[]>`
            SELECT id,
                   GREATEST(
                     ts_rank("searchVector", to_tsquery('english', ${tsquery})),
                     word_similarity(${q}, "title") * 0.6
                   ) AS rank
            FROM "Tutorial"
            WHERE status = 'PUBLISHED'
              AND ("searchVector" @@ to_tsquery('english', ${tsquery})
                   OR word_similarity(${q}, "title") > ${FUZZY_THRESHOLD})
            ORDER BY rank DESC
            LIMIT ${Math.ceil(limit / 2)}
          `
        : Promise.resolve([] as RankedRow[]),
    ]);

    const resourceIds = resourceRows.map((r) => r.id);
    const tutorialIds = tutorialRows.map((r) => r.id);

    const [resources, tutorials, categories] = await Promise.all([
      resourceIds.length
        ? prisma.resource.findMany({ where: { id: { in: resourceIds } }, select: resourceCardSelect })
        : [],
      tutorialIds.length
        ? prisma.tutorial.findMany({
            where: { id: { in: tutorialIds } },
            select: {
              id: true,
              title: true,
              slug: true,
              summary: true,
              coverKey: true,
              durationSeconds: true,
              skillLevel: true,
            },
          })
        : [],
      // Category shortcuts (PRD §28).
      prisma.category.findMany({
        where: { status: 'ACTIVE', name: { contains: q, mode: 'insensitive' } },
        select: { id: true, name: true, slug: true, icon: true },
        take: 4,
      }),
    ]);

    // Preserve the ranking order the database computed.
    const rank = new Map(resourceRows.map((r) => [r.id, Number(r.rank)]));
    const orderedResources = resources
      .sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0))
      .map(toResourceCard);
    const tRank = new Map(tutorialRows.map((r) => [r.id, Number(r.rank)]));
    const orderedTutorials = tutorials
      .sort((a, b) => (tRank.get(b.id) ?? 0) - (tRank.get(a.id) ?? 0))
      .map((t) => ({
        id: t.id,
        title: t.title,
        slug: t.slug,
        summary: t.summary,
        coverUrl: mediaUrl(t.coverKey),
        durationSeconds: t.durationSeconds,
        skillLevel: t.skillLevel,
      }));

    const total = orderedResources.length + orderedTutorials.length;

    // Record what people look for, especially the misses (PRD §66).
    if (suggest === 'false') {
      prisma.searchQuery
        .create({
          data: { query: q.slice(0, 120), resultCount: total, userId: req.user?.id ?? null },
        })
        .catch((err) => logger.warn({ err }, 'failed to record search query'));
    }

    // When nothing matched, offer something useful instead of a dead end.
    let suggestions: Array<{ label: string; href: string }> = [];
    if (total === 0) {
      const popular = await prisma.category.findMany({
        where: { status: 'ACTIVE', parentId: null },
        orderBy: { resources: { _count: 'desc' } },
        take: 4,
        select: { name: true, slug: true },
      });
      suggestions = popular.map((c) => ({ label: c.name, href: `/resources?category=${c.slug}` }));
    }

    res.json({
      query: q,
      resources: orderedResources,
      tutorials: orderedTutorials,
      categories,
      total,
      suggestions,
    });
  }),
);
