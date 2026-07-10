import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const caseStudies = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/case-studies" }),
  schema: z.object({
    client: z.object({
      name: z.string(),
      logo: z.string().optional(),
      url: z.string().url(),
      industry: z.string(),
    }),
    serviceLine: z.string(),
    summary: z.string(),
    before: z.object({
      image: z.string(),
      alt: z.string(),
    }),
    after: z.object({
      type: z.enum(["image", "video", "site"]),
      src: z.string(),
      alt: z.string(),
    }),
    stack: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    ),
    performance: z
      .array(
        z.object({
          metric: z.string(),
          value: z.string(),
          source: z.string(),
        }),
      )
      .optional(),
    changes: z.array(
      z.object({
        before: z.string(),
        after: z.string(),
      }),
    ),
    testimonial: z
      .object({
        quote: z.string(),
        name: z.string(),
        title: z.string(),
      })
      .optional(),
    publishedAt: z.coerce.date(),
  }),
});

export const collections = { caseStudies };
