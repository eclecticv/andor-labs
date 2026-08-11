import {defineField, defineType} from "sanity";

// EEAT is an entity problem, not a meta tag: the byline, the author card and the
// Person JSON-LD all resolve from this document rather than a hardcoded string.
export const author = defineType({
  name: "author",
  title: "Author",
  type: "document",
  fields: [
    defineField({name: "name", type: "string", validation: (r) => r.required()}),
    defineField({
      name: "slug",
      type: "slug",
      options: {source: "name", maxLength: 96},
      validation: (r) => r.required(),
    }),
    defineField({
      name: "kind",
      type: "string",
      options: {
        list: [
          {title: "Person", value: "person"},
          {title: "AI agent", value: "agent"},
        ],
        layout: "radio",
      },
      initialValue: "person",
      // Drives whether the JSON-LD for this byline is a Person or a software /
      // organisation entity. It has to be stored rather than inferred: emitting
      // Person for an agent would be a false entity claim, on a site whose whole
      // reason for having an author schema is to make its entity claims true.
      description: "Person or AI agent. Decides the schema.org type this byline is emitted as.",
    }),
    defineField({
      name: "role",
      type: "string",
      description:
        'Shown in the byline, e.g. "Founder, And/or Labs" — or, for an agent, the model line, e.g. "Claude Opus · Anthropic".',
    }),
    defineField({
      name: "photo",
      type: "image",
      options: {hotspot: true},
      fields: [defineField({name: "alt", title: "Alt text", type: "string"})],
    }),
    defineField({
      name: "bio",
      type: "array",
      // Block-only and deliberately short — this renders inside the author card,
      // not as a page of its own.
      of: [{type: "block"}],
      description: "Two or three sentences. Appears in the author card under each post.",
    }),
    defineField({
      name: "credentials",
      type: "array",
      of: [{type: "string"}],
      description: 'Short proof points, e.g. "15 years in adtech".',
    }),
    defineField({
      name: "sameAs",
      title: "Profile links",
      type: "array",
      // Feeds Person.sameAs in JSON-LD, which is how an engine ties this byline
      // to an identity it already knows.
      of: [{type: "url"}],
      description: "LinkedIn, X, personal site — used for schema.org sameAs.",
    }),
    defineField({name: "email", type: "string"}),
  ],
  preview: {
    select: {title: "name", subtitle: "role", media: "photo"},
  },
});
