import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { sanityClient } from "sanity:client";
import { ICP } from "../../config";
import { toPlainText } from "../../lib/portableText";
import { imageUrl } from "../../lib/sanityImage";
import { toCategory } from "../../lib/categories";

interface FeedPost {
  title: string;
  slug: string;
  excerpt: string;
  standfirst?: string;
  publishedAt: string;
  tags?: string[];
  category?: string;
  body: unknown[];
  heroImage?: unknown;
}

export async function GET(context: APIContext) {
  const posts = await sanityClient.fetch<FeedPost[]>(
    `*[_type == "post" && defined(slug.current) && seo.noIndex != true] | order(publishedAt desc){
      title, "slug": slug.current, excerpt, standfirst, publishedAt, tags, body, heroImage, category
    }`,
  );

  return rss({
    title: "And/or Labs | Writing",
    description: `Essays and explainers on GTM engineering, positioning, and content strategy for ${ICP} founders.`,
    site: context.site!,
    // Newest first. The spec doesn't require ordering, but readers that render
    // the feed in document order will otherwise show the archive backwards.
    items: posts.map((post) => ({
      title: post.title,
      link: `/blog/${post.slug}/`,
      pubDate: new Date(post.publishedAt),
      description: post.standfirst || post.excerpt,
      // Category first: a reader filtering the feed cares which of the three
      // this is before they care what it is about.
      categories: [toCategory(post.category).label, ...(post.tags ?? [])],
      // Plain text, not HTML. Rendering Portable Text to markup here would mean
      // maintaining a second renderer alongside the Astro components, and the
      // two would drift. The full piece is one click away.
      content: toPlainText(post.body as never),
      customData: (() => {
        const img = imageUrl(post.heroImage as never, { width: 1200, height: 630, fit: "crop", format: "jpg" });
        return img ? `<enclosure url="${img}" type="image/jpeg" />` : undefined;
      })(),
    })),
    customData: "<language>en-us</language>",
    stylesheet: false,
  });
}
