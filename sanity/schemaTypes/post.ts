import {defineArrayMember, defineField, defineType} from "sanity";

export const post = defineType({
  name: "post",
  title: "Post",
  type: "document",
  // Without groups the form is a fifteen-field wall and the fields that matter
  // most for a given editing pass are buried among the ones that don't.
  groups: [
    {name: "content", title: "Content", default: true},
    {name: "media", title: "Media"},
    {name: "seo", title: "SEO & AEO"},
    {name: "meta", title: "Meta"},
  ],
  fields: [
    defineField({
      name: "title",
      type: "string",
      group: "content",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "slug",
      type: "slug",
      options: {source: "title", maxLength: 96},
      group: "content",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "author",
      type: "reference",
      to: [{type: "author"}],
      group: "content",
      description: "Byline, author card and Person JSON-LD all resolve from this.",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "standfirst",
      type: "text",
      rows: 3,
      group: "content",
      description: "The deck that sits under the H1. Human-facing — write it to be read, not to rank.",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt / meta description",
      type: "text",
      rows: 3,
      group: "seo",
      // Split out from standfirst deliberately: one field was previously doing
      // three incompatible jobs.
      description:
        "SERP meta description and index-card blurb ONLY — this is never shown on the article page itself. Max 160 characters.",
      validation: (r) => r.required().max(160),
    }),
    defineField({
      name: "keyTakeaways",
      title: "Key takeaways",
      type: "array",
      of: [{type: "string"}],
      // The "gist" box: the single highest-leverage surface for answer engines,
      // which lift these near-verbatim.
      group: ["content", "seo"],
      description: 'Renders as "The gist". Five at most — a list that long stops being a gist.',
      validation: (r) => r.max(5),
    }),
    defineField({
      name: "faq",
      title: "FAQ",
      type: "array",
      group: ["content", "seo"],
      of: [
        defineArrayMember({
          type: "object",
          name: "faqItem",
          fields: [
            defineField({name: "question", type: "string", validation: (r) => r.required()}),
            defineField({name: "answer", type: "text", rows: 4, validation: (r) => r.required()}),
          ],
          preview: {
            select: {title: "question", subtitle: "answer"},
          },
        }),
      ],
      description: "Optional. Rendered on-page and emitted as FAQPage JSON-LD.",
    }),
    defineField({
      name: "heroImage",
      type: "image",
      options: {hotspot: true},
      group: "media",
      description: "Dithered before upload — it is the LCP element and doubles as the OG image.",
      fields: [
        defineField({
          name: "alt",
          title: "Alt text",
          type: "string",
          validation: (r) => r.required(),
        }),
        defineField({name: "caption", type: "string"}),
        defineField({name: "credit", type: "string", description: "Source and licence, e.g. Openverse / CC BY."}),
      ],
    }),
    defineField({
      name: "body",
      type: "array",
      group: "content",
      of: [
        defineArrayMember({
          type: "block",
          // h1 is the post title, so the body starts at h2 and the TOC can be
          // generated from the h2s without guessing.
          styles: [
            {title: "Normal", value: "normal"},
            {title: "Heading 2", value: "h2"},
            {title: "Heading 3", value: "h3"},
            {title: "Heading 4", value: "h4"},
            {title: "Quote", value: "blockquote"},
          ],
          lists: [
            {title: "Bullet", value: "bullet"},
            {title: "Numbered", value: "number"},
          ],
          marks: {
            decorators: [
              {title: "Strong", value: "strong"},
              {title: "Emphasis", value: "em"},
              {title: "Code", value: "code"},
              {title: "Underline", value: "underline"},
              {title: "Strike", value: "strike-through"},
            ],
            annotations: [
              defineArrayMember({
                type: "object",
                name: "link",
                title: "Link",
                fields: [
                  defineField({
                    name: "href",
                    title: "URL",
                    type: "url",
                    validation: (r) => r.required(),
                  }),
                  defineField({name: "newTab", title: "Open in new tab", type: "boolean"}),
                ],
              }),
              defineArrayMember({
                type: "object",
                name: "footnote",
                title: "Footnote",
                fields: [defineField({name: "text", type: "text", rows: 3})],
              }),
            ],
          },
        }),
        // A bare image type is deliberately absent: `figure` carries required alt
        // text, so accessibility cannot be skipped by picking the wrong block.
        defineArrayMember({type: "pullQuote"}),
        defineArrayMember({type: "divider"}),
        defineArrayMember({type: "callout"}),
        defineArrayMember({type: "codeBlock"}),
        defineArrayMember({type: "figure"}),
        defineArrayMember({type: "keyStat"}),
      ],
      validation: (r) => r.required(),
    }),
    defineField({
      name: "targetQuery",
      title: "Target keyword / question",
      description: "The search query or AI-engine question this post answers.",
      type: "string",
      group: "seo",
    }),
    defineField({
      name: "seo",
      title: "SEO overrides",
      type: "object",
      group: "seo",
      options: {collapsible: true, collapsed: true},
      description: "Only fill these in when the defaults derived from title and excerpt are wrong.",
      fields: [
        defineField({name: "metaTitle", type: "string"}),
        defineField({name: "metaDescription", type: "text", rows: 3, validation: (r) => r.max(160)}),
        defineField({name: "noIndex", title: "Hide from search engines", type: "boolean"}),
      ],
    }),
    defineField({
      name: "publishedAt",
      type: "datetime",
      group: "meta",
      validation: (r) => r.required(),
    }),
    defineField({
      name: "updatedAt",
      type: "datetime",
      group: "meta",
      // Emitted as dateModified; leave empty until the post is genuinely revised,
      // since a false modified date is worse than none.
      description: "Set only on a substantive revision. Emitted as schema.org dateModified.",
    }),
    defineField({name: "tags", type: "array", of: [{type: "string"}], group: "meta"}),
    defineField({
      name: "relatedPosts",
      type: "array",
      of: [{type: "reference", to: [{type: "post"}]}],
      group: "meta",
      description: "Manual override. Left empty, the template falls back to posts sharing a tag.",
      validation: (r) => r.max(3),
    }),
  ],
  preview: {
    select: {title: "title", author: "author.name", media: "heroImage"},
    prepare({title, author, media}) {
      return {title, subtitle: author ? `by ${author}` : "No author", media};
    },
  },
});
