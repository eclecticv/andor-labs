import { ICP_STARTUPS } from "../config";
import type { APIRoute } from "astro";
import { sanityClient } from "sanity:client";

export const GET: APIRoute = async ({ site }) => {
  const posts: { title: string; slug: string; excerpt: string }[] =
    await sanityClient.fetch(
      `*[_type == "post" && defined(slug.current)] | order(publishedAt desc){
        title, "slug": slug.current, excerpt
      }`
    );

  const lines = [
    "# And/or Labs",
    "",
    `> Tactical growth partner for ${ICP_STARTUPS}: clear positioning, custom market intelligence, and autonomous growth systems.`,
    "",
    "## Blog",
    "",
    ...posts.map((p) => `- [${p.title}](${new URL(`/blog/${p.slug}/`, site).href}): ${p.excerpt}`),
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
