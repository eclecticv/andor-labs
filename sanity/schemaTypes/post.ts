import {defineField, defineType} from "sanity";

export const post = defineType({
  name: "post",
  title: "Post",
  type: "document",
  fields: [
    defineField({name: "title", type: "string", validation: (r) => r.required()}),
    defineField({
      name: "slug",
      type: "slug",
      options: {source: "title", maxLength: 96},
      validation: (r) => r.required(),
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt / meta description",
      type: "text",
      rows: 3,
      validation: (r) => r.required().max(160),
    }),
    defineField({name: "publishedAt", type: "datetime", validation: (r) => r.required()}),
    defineField({name: "tags", type: "array", of: [{type: "string"}]}),
    defineField({
      name: "targetQuery",
      title: "Target keyword / question",
      description: "The search query or AI-engine question this post answers.",
      type: "string",
    }),
    defineField({name: "heroImage", type: "image", options: {hotspot: true}}),
    defineField({
      name: "body",
      type: "array",
      of: [{type: "block"}, {type: "image", options: {hotspot: true}}],
      validation: (r) => r.required(),
    }),
  ],
  preview: {
    select: {title: "title", subtitle: "excerpt", media: "heroImage"},
  },
});
